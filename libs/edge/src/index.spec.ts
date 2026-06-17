/**
 * Unit/integration test for `createEdgeMcp` — drives the returned Worker
 * module with real Web `Request`/`Response` objects (Node 18+ globals), the
 * same contract a Cloudflare Worker uses. Proves the no-decorator/no-build
 * config path serves MCP end-to-end. The `demo-e2e-cloudflare` app proves it
 * additionally boots inside real workerd.
 */
import 'reflect-metadata';

import { App, Tool, ToolContext, z } from '@frontmcp/sdk';

import { createEdgeMcp } from './index';

const echoInput = { message: z.string() };

@Tool({ name: 'echo', description: 'Echo back the input message', inputSchema: echoInput })
class EchoTool extends ToolContext {
  async execute(input: { message: string }) {
    return { content: [{ type: 'text' as const, text: `Echo: ${input.message}` }] };
  }
}

@App({ id: 'worker-pkg-app', name: 'worker-pkg-app', tools: [EchoTool] })
class WorkerApp {}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

describe('createEdgeMcp', () => {
  const worker = createEdgeMcp({
    info: { name: 'worker-pkg-test', version: '1.0.0' },
    apps: [WorkerApp],
    tasks: { enabled: false },
  });

  const mcp = (body: unknown): Promise<Response> =>
    worker.fetch(new Request('https://worker.example.com/mcp', { method: 'POST', headers: MCP_HEADERS, body: JSON.stringify(body) }));

  it('returns a Worker module synchronously (no eager build)', () => {
    const w = createEdgeMcp({ info: { name: 'lazy', version: '1.0.0' }, apps: [WorkerApp], tasks: { enabled: false } });
    expect(typeof w.fetch).toBe('function');
  });

  it('builds lazily and serves an MCP initialize', async () => {
    const res = await mcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1.0.0' } },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(json.result?.serverInfo?.name).toBe('worker-pkg-test');
  });

  it('lists tools and executes a tool call', async () => {
    const list = (await (await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })).json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    expect((list.result?.tools ?? []).map((t) => t.name)).toContain('echo');

    const call = (await (
      await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { message: 'hi' } } })
    ).json()) as { result?: { content?: Array<{ text?: string }> } };
    expect(call.result?.content?.[0]?.text).toBe('Echo: hi');
  });

  it('serves liveness via the underlying web-fetch handler', async () => {
    const res = await worker.fetch(new Request('https://worker.example.com/healthz'));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });

  it('exposes a Cron `scheduled` handler only in managed mode', () => {
    // Plain edge — no auto-update source, so no scheduled entrypoint.
    expect(worker.scheduled).toBeUndefined();

    // Managed edge — `scheduled` is wired for Cron-driven refresh. Constructing
    // it does NOT import the plugin or boot the scope (both are lazy in build()),
    // so this assertion stays a pure unit check.
    const managed = createEdgeMcp({
      info: { name: 'managed', version: '1.0.0' },
      apps: [],
      tasks: { enabled: false },
      managed: {
        endpoint: 'https://cloud.example.dev/v1/bundles/acme',
        authToken: 'tok',
        expectedAudience: 'acme:prod',
        jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
        expectedIssuer: 'https://cloud.example.dev',
      },
    });
    expect(typeof managed.fetch).toBe('function');
    expect(typeof managed.scheduled).toBe('function');
  });
});
