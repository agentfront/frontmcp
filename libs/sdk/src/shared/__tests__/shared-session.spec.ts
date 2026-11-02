/**
 * A stdio session attached to a shared local server, both in this process: the session's frames reach the server's
 * tools through the server's HTTP flows, and the server asks for the token on every request.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { createSharedServerNonce, deriveSharedServerKeys, verifySharedServerIdentity } from '@frontmcp/auth';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { attachSharedSession } from '../shared-attach';
import { SHARED_IDENTIFY_PATH } from '../shared-endpoint';
import { readServerRecord, sharedServerFiles, type SharedServerRecord } from '../shared-files';
import { serveShared, type SharedServerHandle } from '../shared-serve';

@Tool({ name: 'server_pid', inputSchema: {} })
class ServerPidTool extends ToolContext {
  async execute() {
    return { pid: process.pid };
  }
}

@App({ id: 'shared', name: 'Shared', tools: [ServerPidTool] })
class SharedApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'shared-spec', version: '1.0.0' },
  apps: [SharedApp],
  logging: { level: LogLevel.Off, enableConsole: false },
};

const verboseConfig: FrontMcpConfigInput = { ...config, logging: { level: LogLevel.Verbose, enableConsole: true } };

const create = (parsed: ConstructorParameters<typeof FrontMcpInstance>[0]) => new FrontMcpInstance(parsed);

interface Frame {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** Speak newline-delimited JSON-RPC to a session through its stdio streams. */
function clientOf(input: PassThrough, output: PassThrough) {
  const received: Frame[] = [];
  let pending = '';
  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) if (line) received.push(JSON.parse(line) as Frame);
  });
  return {
    send: (frame: Frame) => input.write(`${JSON.stringify(frame)}\n`),
    async request(frame: Frame): Promise<Frame> {
      input.write(`${JSON.stringify(frame)}\n`);
      const deadline = Date.now() + 15_000;
      for (;;) {
        const answer = received.find(({ id }) => id === frame.id);
        if (answer) return answer;
        if (Date.now() > deadline) throw new Error(`no answer to ${frame.method}: ${JSON.stringify(received)}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

const initialize: Frame = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'shared-spec', version: '1.0.0' } },
};

function pidOf(answer: Frame): unknown {
  const result = answer.result as { structuredContent?: { pid?: number }; content?: Array<{ text: string }> };
  return result.structuredContent?.pid ?? (JSON.parse(result.content?.[0]?.text ?? '{}') as { pid?: number }).pid;
}

function post(
  record: SharedServerRecord,
  urlPath: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: record.port,
        path: urlPath,
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk: Buffer) => (text += chunk.toString()));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

posixOnly('a shared local server', () => {
  let home: string;
  let previousHome: string | undefined;
  let servers: SharedServerHandle[];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    servers = [];
  });

  afterEach(async () => {
    for (const server of servers) await server.close();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function serve(transport: 'unix' | 'http', serverConfig = config): Promise<SharedServerRecord> {
    servers.push(await serveShared(serverConfig, { key: 'spec', transport }, create));
    const record = await readServerRecord(sharedServerFiles('spec'));
    if (!record) throw new Error('the shared server wrote no record');
    return record;
  }

  describe.each(['unix', 'http'] as const)('over %s', (transport) => {
    it('serves an attached session through its flows', async () => {
      await serve(transport);
      const input = new PassThrough();
      const output = new PassThrough();
      const session = attachSharedSession({
        key: 'spec',
        transport,
        input,
        output,
        spawnServer: () => {
          throw new Error('the running server should be found');
        },
      });
      const client = clientOf(input, output);
      try {
        await session.attached;
        expect((await client.request(initialize)).result).toBeDefined();
        client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const call = await client.request({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'server_pid', arguments: {} },
        });
        expect(pidOf(call)).toBe(process.pid);
      } finally {
        await session.stop();
      }
    });

    it('starts the server when none runs, then attaches to it', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let spawned = 0;
      const session = attachSharedSession({
        key: 'spec',
        transport,
        input,
        output,
        spawnServer: () => {
          spawned++;
          void serveShared(config, { key: 'spec', transport }, create).then((server) => servers.push(server));
          return { exitReason: undefined };
        },
      });
      const client = clientOf(input, output);
      try {
        expect((await client.request(initialize)).result).toBeDefined();
        await session.attached;
        expect(spawned).toBe(1);
      } finally {
        await session.stop();
      }
    });

    it('answers the requests it held, and fails, when it can not reach a server', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const session = attachSharedSession({
        key: 'spec',
        transport,
        input,
        output,
        spawnServer: () => ({ exitReason: 'it exited with code 1' }),
      });
      const client = clientOf(input, output);
      try {
        const answer = client.request(initialize);
        await expect(session.attached).rejects.toThrow('The shared server "spec" did not start: it exited with code 1');
        expect((await answer).error).toMatchObject({
          message: 'dev_reload_deadline',
          data: { error: 'The shared server "spec" did not start: it exited with code 1' },
        });
        expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain('attach-failed');
      } finally {
        stderr.mockRestore();
        await session.stop();
      }
    });

    it('keeps its files owner-only and removes its record when it stops', async () => {
      const record = await serve(transport);
      const files = sharedServerFiles('spec');
      expect(fs.statSync(files.directory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(files.recordFile).mode & 0o777).toBe(0o600);
      if (transport === 'unix') expect(fs.statSync(files.socketPath).mode & 0o777).toBe(0o600);
      expect(record.pid).toBe(process.pid);

      await (servers.pop() as SharedServerHandle).close();
      expect(fs.existsSync(files.recordFile)).toBe(false);
    });
  });

  it('releases what it built when another process holds its socket', async () => {
    const files = sharedServerFiles('spec');
    fs.mkdirSync(files.directory, { recursive: true, mode: 0o700 });
    const holder = net.createServer();
    await new Promise<void>((resolve) => holder.listen(files.socketPath, resolve));
    try {
      await expect(serveShared(config, { key: 'spec', transport: 'unix' }, create)).rejects.toThrow('already in use');
      expect(fs.existsSync(files.recordFile)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  describe('over loopback HTTP', () => {
    it('ends its MCP session on the server when the session stops', async () => {
      await serve('http');
      const sent = jest.spyOn(globalThis, 'fetch');
      const input = new PassThrough();
      const output = new PassThrough();
      const session = attachSharedSession({ key: 'spec', transport: 'http', input, output });
      try {
        await session.attached;
        await clientOf(input, output).request(initialize);
        await session.stop();
        const ended = sent.mock.calls.find(([, init]) => init?.method === 'DELETE');
        const headers = ended?.[1]?.headers as Record<string, string> | undefined;
        expect(headers?.['mcp-session-id']).toEqual(expect.any(String));
        expect(headers?.['authorization']).toMatch(/^Bearer /);
      } finally {
        sent.mockRestore();
      }
    });

    it('refuses every MCP request without the token', async () => {
      const record = await serve('http');
      const { token } = deriveSharedServerKeys(record.secret);

      expect((await post(record, record.path, {}, initialize)).status).toBe(401);
      expect((await post(record, record.path, { authorization: 'Bearer wrong' }, initialize)).status).toBe(401);
      expect((await post(record, record.path, { authorization: `Bearer ${token}` }, initialize)).status).toBe(200);
    });

    it('proves its identity bound to its own endpoint, without the token', async () => {
      const record = await serve('http');
      const { proofKey } = deriveSharedServerKeys(record.secret);
      const nonce = createSharedServerNonce();

      const answer = await post(record, SHARED_IDENTIFY_PATH, {}, { nonce });
      const { proof } = JSON.parse(answer.body) as { proof: string };

      expect(answer.status).toBe(200);
      expect(verifySharedServerIdentity(proofKey, `http://127.0.0.1:${record.port}`, nonce, proof)).toBe(true);
      expect((await post(record, SHARED_IDENTIFY_PATH, {}, { nonce: 'short' })).status).toBe(400);
    });

    it('refuses a request from a web page: any Origin, or a Host that is not loopback', async () => {
      const record = await serve('http');
      const { token } = deriveSharedServerKeys(record.secret);
      const credential = { authorization: `Bearer ${token}` };

      for (const origin of ['https://evil.example', `http://127.0.0.1:${record.port}`, 'null']) {
        expect((await post(record, record.path, { ...credential, origin }, initialize)).status).toBe(403);
        expect(
          (await post(record, SHARED_IDENTIFY_PATH, { origin }, { nonce: createSharedServerNonce() })).status,
        ).toBe(403);
      }
      expect(
        (await post(record, record.path, { ...credential, host: `evil.example:${record.port}` }, initialize)).status,
      ).toBe(403);
    });

    it('listens on loopback only', async () => {
      const record = await serve('http');
      const external = Object.values(os.networkInterfaces())
        .flat()
        .find((address) => address && address.family === 'IPv4' && !address.internal);
      if (!external) return;
      const connected = await new Promise<boolean>((resolve) => {
        const request = http.request({
          host: external.address,
          port: record.port,
          path: '/',
          method: 'GET',
          timeout: 2_000,
        });
        request.on('response', () => resolve(true));
        request.on('error', () => resolve(false));
        request.on('timeout', () => {
          request.destroy();
          resolve(false);
        });
        request.end();
      });
      expect(connected).toBe(false);
    });

    it('writes neither its secret nor its token to a log', async () => {
      const written: string[] = [];
      const capture = (stream: NodeJS.WriteStream) =>
        jest.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        });
      const spies = [capture(process.stdout), capture(process.stderr)];
      const consoleSpies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((method) =>
        jest
          .spyOn(console, method)
          .mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(' '))),
      );
      try {
        const record = await serve('http', verboseConfig);
        const { token } = deriveSharedServerKeys(record.secret);
        await post(record, record.path, { authorization: `Bearer ${token}` }, initialize);
        await post(record, record.path, { authorization: 'Bearer wrong' }, initialize);
        await post(record, SHARED_IDENTIFY_PATH, {}, { nonce: createSharedServerNonce() });
        await (servers.pop() as SharedServerHandle).close();

        const logDirectory = path.join(home, 'logs');
        const files = fs.existsSync(logDirectory) ? fs.readdirSync(logDirectory) : [];
        const everything = [
          ...written,
          ...files.map((file) => fs.readFileSync(path.join(logDirectory, file), 'utf8')),
        ].join('\n');
        expect(everything.length).toBeGreaterThan(0);
        expect(everything).not.toContain(token);
        expect(everything).not.toContain(record.secret);
      } finally {
        for (const spy of [...spies, ...consoleSpies]) spy.mockRestore();
      }
    });
  });
});
