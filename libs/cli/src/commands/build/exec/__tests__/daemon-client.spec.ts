import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { generateDaemonClientSource } from '../cli-runtime/daemon-client';

interface DaemonClient {
  connect(): Promise<void>;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  listResources(): Promise<unknown>;
  loadSkills(ids: string[]): Promise<unknown>;
  listJobs(): Promise<unknown>;
  close(): Promise<void>;
}

interface DaemonClientModule {
  createDaemonClient(socketPath: string, options?: { authToken?: string; entryPath?: string }): DaemonClient;
}

interface ReceivedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: { id?: number; method?: string; params?: Record<string, unknown> } | undefined;
}

type Reply = (res: http.ServerResponse, message: { id?: number; method?: string; params?: Record<string, unknown> }) => void;

const SESSION_ID = 'session-1';

function loadDaemonClient(): DaemonClientModule {
  const loadedModule = { exports: {} as DaemonClientModule };
  new Function('require', 'exports', 'module', generateDaemonClientSource())(require, loadedModule.exports, loadedModule);
  return loadedModule.exports;
}

function replyEventStream(res: http.ServerResponse, ...messages: unknown[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': SESSION_ID });
  res.end(messages.map((message) => `event: message\ndata: ${JSON.stringify(message)}\n\n`).join(''));
}

function replyJson(res: http.ServerResponse, message: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(message));
}

const replies: Record<string, Reply> = {
  initialize: (res, message) => replyEventStream(res, { jsonrpc: '2.0', id: message.id, result: { capabilities: {} } }),
  'notifications/initialized': (res) => {
    res.writeHead(202);
    res.end();
  },
  'tools/call': (res, message) => {
    if (message.params?.['name'] === 'list_jobs') {
      replyJson(res, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: '{"jobs":[],"count":0}' }] } });
      return;
    }
    if (message.params?.['name'] === 'broken') {
      replyJson(res, { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid arguments' } });
      return;
    }
    replyEventStream(
      res,
      { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } },
      { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: '3' }] } },
    );
  },
  'resources/list': (res, message) => {
    const cursor = message.params?.['cursor'];
    const result = cursor ? { resources: [{ uri: 'b://2' }] } : { resources: [{ uri: 'a://1' }], nextCursor: 'page-2' };
    replyJson(res, { jsonrpc: '2.0', id: message.id, result });
  },
  'skills/load': (res, message) => replyJson(res, { jsonrpc: '2.0', id: message.id, result: { skills: [] } }),
};

describe('generateDaemonClientSource', () => {
  let dir: string;
  let socketPath: string;
  let server: http.Server;
  let received: ReceivedRequest[];
  let createDaemonClient: DaemonClientModule['createDaemonClient'];

  beforeAll(async () => {
    createDaemonClient = loadDaemonClient().createDaemonClient;
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-daemon-'));
    socketPath = path.join(dir, 'daemon.sock');
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        const body = text ? JSON.parse(text) : undefined;
        received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
        if (req.url !== '/mcp') {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<pre>Cannot POST</pre>');
          return;
        }
        if (req.method === 'DELETE') {
          res.writeHead(200);
          res.end();
          return;
        }
        replies[body.method](res, body);
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  beforeEach(() => {
    received = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it('opens a session at the entry path: initialize, then notifications/initialized with the session id', async () => {
    await createDaemonClient(socketPath, { entryPath: '/mcp' }).connect();

    expect(received.map((request) => [request.url, request.body?.method])).toEqual([
      ['/mcp', 'initialize'],
      ['/mcp', 'notifications/initialized'],
    ]);
    expect(received[0].headers['accept']).toBe('application/json, text/event-stream');
    expect(received[0].headers['mcp-session-id']).toBeUndefined();
    expect(received[1].headers['mcp-session-id']).toBe(SESSION_ID);
  });

  it('sends calls with the session and reads the result out of an event stream', async () => {
    const client = createDaemonClient(socketPath, { entryPath: '/mcp' });
    await client.connect();

    await expect(client.callTool('add', { a: 1, b: 2 })).resolves.toEqual({ content: [{ type: 'text', text: '3' }] });
    const call = received[2];
    expect(call.body).toMatchObject({ method: 'tools/call', params: { name: 'add', arguments: { a: 1, b: 2 } } });
    expect(call.headers['mcp-session-id']).toBe(SESSION_ID);
    expect(call.headers['mcp-protocol-version']).toBe('2025-11-25');
  });

  it('rejects a JSON-RPC error with its message and code', async () => {
    const client = createDaemonClient(socketPath, { entryPath: '/mcp' });
    await client.connect();

    await expect(client.callTool('broken')).rejects.toMatchObject({ message: 'Invalid arguments', code: -32602 });
  });

  it('rejects with the HTTP status when the path serves no MCP endpoint', async () => {
    await expect(createDaemonClient(socketPath, { entryPath: '/' }).connect()).rejects.toThrow(
      'the daemon answered HTTP 404',
    );
  });

  it('reads every page of a list', async () => {
    const client = createDaemonClient(socketPath, { entryPath: '/mcp' });
    await client.connect();

    await expect(client.listResources()).resolves.toEqual({ resources: [{ uri: 'a://1' }, { uri: 'b://2' }] });
  });

  it('loads skills by skillIds, as skills/load expects', async () => {
    const client = createDaemonClient(socketPath, { entryPath: '/mcp' });
    await client.connect();
    await client.loadSkills(['invoices']);

    expect(received[2].body?.params).toEqual({ skillIds: ['invoices'] });
  });

  it('lists jobs through the list_jobs tool, as the in-process client does', async () => {
    const client = createDaemonClient(socketPath, { entryPath: '/mcp' });
    await client.connect();

    await expect(client.listJobs()).resolves.toEqual({ jobs: [], count: 0 });
    expect(received[2].body?.params).toEqual({ name: 'list_jobs', arguments: {} });
  });

  it('sends the auth token as a bearer Authorization header on every request, and none without one', async () => {
    await createDaemonClient(socketPath, { entryPath: '/mcp', authToken: 'tok-123' }).connect();
    await createDaemonClient(socketPath, { entryPath: '/mcp' }).connect();

    expect(received.map((request) => request.headers['authorization'])).toEqual([
      'Bearer tok-123',
      'Bearer tok-123',
      undefined,
      undefined,
    ]);
  });

  it('ends the session on close', async () => {
    const client = createDaemonClient(socketPath, { entryPath: '/mcp' });
    await client.connect();
    await client.close();

    expect(received[2]).toMatchObject({ method: 'DELETE', url: '/mcp' });
    expect(received[2].headers['mcp-session-id']).toBe(SESSION_ID);
  });

  it('rejects when nothing listens on the socket', async () => {
    await expect(createDaemonClient(path.join(dir, 'missing.sock')).connect()).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
