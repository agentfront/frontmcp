/**
 * The web-fetch handler must honour the same HTTP-layer config the Express host
 * does: security headers, `http.bodyLimit`, and `health.*` (#646).
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/protocol';

import { Tool, ToolContext } from '../../common';
import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { createWebFetchHandler, type WebFetchHandler } from '../web-fetch-handler';

const echoInput = { message: z.string() };

@Tool({ name: 'echo', description: 'Echoes the message', inputSchema: echoInput })
class EchoTool extends ToolContext {
  async execute(input: z.infer<z.ZodObject<typeof echoInput>>): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: `Echo: ${input.message}` }] };
  }
}

@App({ id: 'hardening-app', name: 'hardening-app', tools: [EchoTool] })
class HardeningApp {}

const INITIALIZE = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
};

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

async function build(
  overrides: Record<string, unknown>,
): Promise<{ instance: FrontMcpInstance; handler: WebFetchHandler }> {
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'hardening-test', version: '1.0.0' },
    apps: [HardeningApp],
    ...overrides,
  } as never);
  const scope = instance.getScopes()[0] as Scope;
  return { instance, handler: createWebFetchHandler(scope) };
}

function post(body: string): Request {
  return new Request('https://worker.example.com/mcp', { method: 'POST', headers: MCP_HEADERS, body });
}

function chunkedPost(chunks: string[]): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Request('https://worker.example.com/mcp', {
    method: 'POST',
    headers: MCP_HEADERS,
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

describe('web-fetch handler: security headers', () => {
  let instance: FrontMcpInstance;
  let handler: WebFetchHandler;

  beforeAll(async () => {
    ({ instance, handler } = await build({
      http: {
        entryPath: '/mcp',
        securityHeaders: { hsts: 'max-age=31536000', custom: { 'Referrer-Policy': 'no-referrer' } },
      },
    }));
  });
  afterAll(async () => instance?.dispose?.());

  it.each([
    ['health probe', () => new Request('https://worker.example.com/healthz')],
    ['MCP response', () => post(JSON.stringify(INITIALIZE))],
    ['404', () => new Request('https://worker.example.com/nope')],
  ])('sends the default and configured headers on a %s', async (_label, make) => {
    const res = await handler(make());
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-powered-by')).toBeNull();
    await res.body?.cancel();
  });
});

describe('web-fetch handler: http.bodyLimit', () => {
  let instance: FrontMcpInstance;
  let handler: WebFetchHandler;

  beforeAll(async () => {
    ({ instance, handler } = await build({ http: { entryPath: '/mcp', bodyLimit: '1kb' } }));
  });
  afterAll(async () => instance?.dispose?.());

  it('rejects a declared content-length over the limit with a structured 413', async () => {
    const res = await handler(post(JSON.stringify({ ...INITIALIZE, pad: 'x'.repeat(2048) })));
    expect(res.status).toBe(413);
    const body = (await res.json()) as {
      jsonrpc: string;
      error: { code: number; message: string; data: { limit: number } };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.message).toBe('Payload Too Large');
    expect(body.error.data.limit).toBe(1024);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects a chunked body (no content-length) that grows past the limit', async () => {
    const chunk = 'x'.repeat(600);
    const res = await handler(chunkedPost(['{"a":"', chunk, chunk, chunk, '"}']));
    expect(res.status).toBe(413);
  });

  it('counts the bytes actually sent when content-length understates the body', async () => {
    const request = new Request('https://worker.example.com/mcp', {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'content-length': '10' },
      body: JSON.stringify({ ...INITIALIZE, pad: 'x'.repeat(2048) }),
    });
    const res = await handler(request);
    expect(res.status).toBe(413);
  });

  it('accepts a body under the limit', async () => {
    const res = await handler(post(JSON.stringify(INITIALIZE)));
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });
});

describe('web-fetch handler: health config', () => {
  it('serves the configured healthzPath and no longer the default', async () => {
    const { instance, handler } = await build({ http: { entryPath: '/mcp' }, health: { healthzPath: '/live' } });
    try {
      const live = await handler(new Request('https://worker.example.com/live'));
      expect(live.status).toBe(200);
      const gone = await handler(new Request('https://worker.example.com/healthz'));
      expect(gone.status).toBe(404);
    } finally {
      await instance.dispose?.();
    }
  });

  it('does not answer health paths when health.enabled is false', async () => {
    const { instance, handler } = await build({ http: { entryPath: '/mcp' }, health: { enabled: false } });
    try {
      for (const path of ['/healthz', '/readyz']) {
        const res = await handler(new Request(`https://worker.example.com${path}`));
        expect(res.status).toBe(404);
      }
    } finally {
      await instance.dispose?.();
    }
  });

  it('reports real readiness from the health service on /readyz', async () => {
    const { instance, handler } = await build({
      http: { entryPath: '/mcp' },
      health: {
        readyz: { enabled: true },
        probes: [{ name: 'db', check: async () => ({ status: 'unhealthy', error: 'down' }) }],
      },
    });
    try {
      const res = await handler(new Request('https://worker.example.com/readyz'));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('not_ready');
    } finally {
      await instance.dispose?.();
    }
  });
});
