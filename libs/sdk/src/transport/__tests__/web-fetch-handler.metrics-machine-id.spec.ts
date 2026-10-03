/**
 * `createFetchHandler()` answers the same HTTP surface the Express host does (#680):
 *  - `/metrics` when `metrics.enabled: true` (it answered 404), and
 *  - `X-FrontMCP-Machine-Id` on every response of a distributed instance — health probes, 404s and
 *    every MCP protocol revision, not only the session and stateless flows (#665).
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/protocol';
import { getMachineId, resetRuntimeContext } from '@frontmcp/utils';

import { Tool, ToolContext } from '../../common';
import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { MetricsPathConflictError } from '../../metrics';
import { type WebFetchHandler } from '../web-fetch-handler';

const echoInput = { message: z.string() };

@Tool({ name: 'echo', description: 'Echoes the message', inputSchema: echoInput })
class EchoTool extends ToolContext {
  async execute(input: z.infer<z.ZodObject<typeof echoInput>>): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: `Echo: ${input.message}` }] };
  }
}

@App({ id: 'metrics-app', name: 'metrics-app', tools: [EchoTool] })
class MetricsApp {}

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const BASE = 'https://worker.example.com';

function handlerFor(overrides: Record<string, unknown>): Promise<WebFetchHandler> {
  return FrontMcpInstance.createFetchHandler({
    info: { name: 'metrics-test', version: '1.0.0' },
    apps: [MetricsApp],
    http: { entryPath: '/mcp' },
    ...overrides,
  } as never);
}

describe('createFetchHandler: /metrics', () => {
  it('serves the Prometheus scrape when metrics.enabled is true', async () => {
    const handler = await handlerFor({ metrics: { enabled: true } });
    const res = await handler(new Request(`${BASE}/metrics`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(typeof (await res.text())).toBe('string');
  });

  it('serves JSON on a custom path', async () => {
    const handler = await handlerFor({ metrics: { enabled: true, path: '/internal/metrics', format: 'json' } });
    const res = await handler(new Request(`${BASE}/internal/metrics/`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ counters: expect.any(Array) }));
    expect((await handler(new Request(`${BASE}/metrics`))).status).toBe(404);
  });

  it('applies token auth like the Express route', async () => {
    const handler = await handlerFor({ metrics: { enabled: true, auth: { token: 's3cret' } } });
    expect((await handler(new Request(`${BASE}/metrics`))).status).toBe(401);
    const wrong = await handler(new Request(`${BASE}/metrics`, { headers: { authorization: 'Bearer nope' } }));
    expect(wrong.status).toBe(403);
    const right = await handler(new Request(`${BASE}/metrics`, { headers: { authorization: 'Bearer s3cret' } }));
    expect(right.status).toBe(200);
  });

  it('still answers 404 when metrics are not enabled', async () => {
    const handler = await handlerFor({});
    expect((await handler(new Request(`${BASE}/metrics`))).status).toBe(404);
  });

  it('only answers GET', async () => {
    const handler = await handlerFor({ metrics: { enabled: true } });
    const res = await handler(new Request(`${BASE}/metrics`, { method: 'POST', body: '{}' }));
    expect(res.status).toBe(404);
  });

  it('answers a health probe path with the probe, as the Express host does, when metrics share it', async () => {
    const handler = await handlerFor({ metrics: { enabled: true, path: '/healthz' } });
    const res = await handler(new Request(`${BASE}/healthz`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ status: 'ok', transport: 'web-fetch' }));
  });

  it('refuses a metrics path that is also the MCP entry path, so it cannot take over GET on the entry', async () => {
    await expect(
      handlerFor({ http: { entryPath: '/api' }, metrics: { enabled: true, path: '/api/' } }),
    ).rejects.toBeInstanceOf(MetricsPathConflictError);
  });
});

describe('web-fetch handler: X-FrontMCP-Machine-Id', () => {
  const originalMode = process.env['FRONTMCP_DEPLOYMENT_MODE'];
  let handler: WebFetchHandler;

  beforeAll(async () => {
    handler = await handlerFor({});
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    else process.env['FRONTMCP_DEPLOYMENT_MODE'] = originalMode;
    resetRuntimeContext();
  });

  const distributed = () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';
    resetRuntimeContext();
  };

  const initialize20250618 = () =>
    new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
      }),
    });

  const toolsList20260728 = () =>
    new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });

  it.each([
    ['health probe', () => new Request(`${BASE}/healthz`)],
    ['404', () => new Request(`${BASE}/nope`)],
    ['session-era MCP response', initialize20250618],
    ['2026-07-28 MCP response', toolsList20260728],
  ])('is sent on a %s in distributed mode', async (_label, make) => {
    distributed();
    const res = await handler(make());
    expect(res.headers.get('x-frontmcp-machine-id')).toBe(getMachineId());
    await res.body?.cancel();
  });

  it('is not sent outside distributed mode', async () => {
    delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    resetRuntimeContext();
    const res = await handler(new Request(`${BASE}/healthz`));
    expect(res.headers.get('x-frontmcp-machine-id')).toBeNull();
  });
});
