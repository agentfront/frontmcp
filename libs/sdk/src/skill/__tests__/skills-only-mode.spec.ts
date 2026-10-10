/**
 * `?mode=skills_only`: a client connected with it sees no tools and cannot run them, on every
 * transport and in every auth mode. Only skill discovery (`skills/*`, `skill://` resources) is served.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Resource, ResourceContext, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const runs: string[] = [];

@Tool({ name: 'deploy', inputSchema: {} })
class DeployTool extends ToolContext {
  async execute() {
    runs.push('deploy');
    return { deployed: true };
  }
}

@Resource({ name: 'deploy-status', uri: 'ops://deploy-status', mimeType: 'application/json' })
class DeployStatusResource extends ResourceContext {
  async execute(uri: string) {
    const result = await this.callTool('deploy', {});
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result.structuredContent) }] };
  }
}

@App({ id: 'ops', name: 'Ops', tools: [DeployTool], resources: [DeployStatusResource] })
class OpsApp {}

const config = { info: { name: 'skills-only', version: '1.0.0' }, apps: [OpsApp] };

function parseRpc(text: string): { result?: Record<string, unknown>; error?: { message: string } } {
  const data = text
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  return JSON.parse(data ?? text);
}

beforeEach(() => {
  runs.length = 0;
});

describe('skills-only mode on the fetch handler', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer(config);
  });

  describe('MCP 2026-07-28', () => {
    it('lists no tools', async () => {
      const { message } = await rpc20260728(server.handler, 'tools/list', {}, { path: '/?mode=skills_only' });

      expect(message.result?.['tools']).toEqual([]);
    });

    it('refuses a tool call as for an unknown tool', async () => {
      const { message } = await rpc20260728(
        server.handler,
        'tools/call',
        { name: 'deploy', arguments: {} },
        { path: '/?mode=skills_only' },
      );

      expect(runs).toEqual([]);
      expect(JSON.stringify(message.error ?? message.result)).toContain('Tool \\"deploy\\" not found');
    });

    it('still runs a tool the server calls in process', async () => {
      const { message } = await rpc20260728(
        server.handler,
        'resources/read',
        { uri: 'ops://deploy-status' },
        { path: '/?mode=skills_only' },
      );

      expect(runs).toEqual(['deploy']);
      expect(JSON.stringify(message.result)).toContain('deployed');
    });

    it('lists and runs tools for a request without the query', async () => {
      const listed = await rpc20260728(server.handler, 'tools/list', {});
      const called = await rpc20260728(server.handler, 'tools/call', { name: 'deploy', arguments: {} });

      expect(JSON.stringify(listed.message.result)).toContain('deploy');
      expect(called.message.error).toBeUndefined();
      expect(runs).toEqual(['deploy']);
    });
  });

  describe('createFetchHandler(), stateless 2025-06-18', () => {
    let fetchHandler: Awaited<ReturnType<typeof FrontMcpInstance.createFetchHandler>>;

    beforeAll(async () => {
      fetchHandler = await FrontMcpInstance.createFetchHandler({ ...config, logging: { level: LogLevel.Off } });
    });

    async function post(method: string, params: Record<string, unknown>) {
      const response = await fetchHandler(
        new Request('http://localhost/?mode=skills_only', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-06-18',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      );
      return parseRpc(await response.text());
    }

    it('lists no tools', async () => {
      const message = await post('tools/list', {});

      expect(message.result?.['tools']).toEqual([]);
    });

    it('refuses a tool call', async () => {
      const message = await post('tools/call', { name: 'deploy', arguments: {} });

      expect(runs).toEqual([]);
      expect(JSON.stringify(message.error ?? message.result)).toContain('not found');
    });
  });
});

describe('skills-only mode on an anonymous streamable HTTP session opened with 2025-11-25', () => {
  let node: http.Server;
  let base: string;
  let sessionId: string;

  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}, path = '/?mode=skills_only') =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
    });

  beforeAll(async () => {
    const app = (await FrontMcpInstance.createHandler({
      ...config,
      logging: { level: LogLevel.Off },
    })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;

    const initialized = await post({
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'planner', version: '1.0.0' } },
    });
    sessionId = initialized.headers.get('mcp-session-id') ?? '';
    await initialized.text();
    expect(sessionId).not.toBe('');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      node.close(() => resolve());
      node.closeAllConnections();
    });
  });

  it('lists no tools', async () => {
    const response = await post({ method: 'tools/list', params: {} }, { 'mcp-session-id': sessionId });

    expect(parseRpc(await response.text()).result?.['tools']).toEqual([]);
  });

  it('refuses a tool call', async () => {
    const response = await post(
      { method: 'tools/call', params: { name: 'deploy', arguments: {} } },
      { 'mcp-session-id': sessionId },
    );
    const message = parseRpc(await response.text());

    expect(runs).toEqual([]);
    expect(JSON.stringify(message.error ?? message.result)).toContain('not found');
  });

  it('keeps the mode for the session when a request leaves the query out', async () => {
    const listed = await post({ method: 'tools/list', params: {} }, { 'mcp-session-id': sessionId }, '/');
    const called = await post(
      { method: 'tools/call', params: { name: 'deploy', arguments: {} } },
      { 'mcp-session-id': sessionId },
      '/',
    );

    expect(parseRpc(await listed.text()).result?.['tools']).toEqual([]);
    expect(JSON.stringify(parseRpc(await called.text()))).toContain('not found');
    expect(runs).toEqual([]);
  });
});

describe('skills-only mode on an anonymous legacy SSE session', () => {
  let node: http.Server;
  let base: string;
  const abort = new AbortController();

  beforeAll(async () => {
    const app = (await FrontMcpInstance.createHandler({
      ...config,
      logging: { level: LogLevel.Off },
    })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    abort.abort();
    await new Promise<void>((resolve) => {
      node.close(() => resolve());
      node.closeAllConnections();
    });
  });

  it('lists no tools and refuses a tool call', async () => {
    const stream = await fetch(`${base}/sse?mode=skills_only`, {
      headers: { accept: 'text/event-stream' },
      signal: abort.signal,
    });
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    const nextData = async (): Promise<string> => {
      for (;;) {
        const end = buffered.indexOf('\n\n');
        if (end >= 0) {
          const raw = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          return raw
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim())
            .join('');
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('the SSE stream ended');
        buffered += decoder.decode(value, { stream: true });
      }
    };
    const endpoint = new URL(await nextData(), base);
    const request = async (id: number, method: string, params: Record<string, unknown>) => {
      await (
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        })
      ).text();
      for (;;) {
        const data = await nextData();
        if (!data) continue;
        const message = JSON.parse(data) as {
          id?: number;
          result?: Record<string, unknown>;
          error?: Record<string, unknown>;
        };
        if (message.id === id) return message.result ?? message.error ?? {};
      }
    };
    await request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'p', version: '1' },
    });

    const listed = await request(2, 'tools/list', {});
    const called = await request(3, 'tools/call', { name: 'deploy', arguments: {} });

    expect(listed['tools']).toEqual([]);
    expect(JSON.stringify(called)).toContain('not found');
    expect(runs).toEqual([]);
  });
});
