/**
 * Integration test for the Web-standard fetch handler (Cloudflare Worker path).
 *
 * Drives `createWebFetchHandler` with REAL Web `Request`/`Response` objects
 * (Node 18+ globals) against a real Scope. This reproduces the exact runtime
 * contract a Cloudflare Worker uses — and would have caught the old bug where
 * the Worker passed a Web `ReadableStream` body into Express (which silently
 * never parsed it). The body-in / JSON-RPC-out path is runtime-agnostic JS, so
 * a pass here means the bridge logic is correct; the workerd e2e adds the
 * isolate-level guarantee on top.
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

@App({ id: 'web-fetch-app', name: 'web-fetch-app', tools: [EchoTool] })
class WebFetchApp {}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function mcpRequest(body: unknown): Request {
  return mcpRequestAt('/mcp', body);
}

function mcpRequestAt(path: string, body: unknown): Request {
  return new Request(`https://worker.example.com${path}`, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
};

/**
 * Read an MCP JSON-RPC response, transparently handling both buffered JSON and
 * an SSE stream. A stateless POST comes back as buffered `application/json` (no
 * session → no server-push, and an unclosed SSE reply would hang the worker); a
 * standalone GET notification stream or a stateful Durable-Object session comes
 * back as `event: message` / `data: {…}` SSE instead.
 */
async function readMcpResult<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    if (!dataLine) throw new Error(`No SSE data frame in response: ${text}`);
    return JSON.parse(dataLine.slice('data:'.length).trim()) as T;
  }
  return JSON.parse(text) as T;
}

describe('createWebFetchHandler (Cloudflare Worker path)', () => {
  let instance: FrontMcpInstance;
  let handler: WebFetchHandler;

  beforeAll(async () => {
    instance = await FrontMcpInstance.createForGraph({
      info: { name: 'web-fetch-test', version: '1.0.0' },
      apps: [WebFetchApp],
      // Serve at /mcp (config-driven) so `mcpRequest` (which posts to /mcp) hits
      // the endpoint; the default would otherwise be the worker root `/`.
      http: { entryPath: '/mcp' },
    });
    const scope = instance.getScopes()[0] as Scope;
    handler = createWebFetchHandler(scope);
  });

  afterAll(async () => {
    await instance?.dispose?.();
  });

  it('answers liveness probes without spinning up the MCP server', async () => {
    const res = await handler(new Request('https://worker.example.com/healthz'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; transport: string };
    expect(body.status).toBe('ok');
    expect(body.transport).toBe('web-fetch');
  });

  it('handles an MCP initialize over a real Web Request (body is actually read)', async () => {
    const res = await handler(
      mcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    );

    expect(res.status).toBe(200);
    const json = await readMcpResult<{
      result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> };
    }>(res);
    expect(json.result?.serverInfo?.name).toBe('web-fetch-test');
    expect(json.result?.capabilities).toBeDefined();
  });

  it('serves tools/list statelessly (fresh transport per request, no session)', async () => {
    const res = await handler(mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));

    expect(res.status).toBe(200);
    const json = await readMcpResult<{ result?: { tools?: Array<{ name: string }> } }>(res);
    const names = (json.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain('echo');
  });

  it('executes a tool call end-to-end over the Web fetch handler', async () => {
    const res = await handler(
      mcpRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'hi' } },
      }),
    );

    expect(res.status).toBe(200);
    const json = await readMcpResult<{
      result?: { content?: Array<{ type: string; text?: string }> };
    }>(res);
    expect(json.result?.content?.[0]?.text).toBe('Echo: hi');
  });
});

describe('createWebFetchHandler config-driven routing, CORS & SSE', () => {
  const instances: FrontMcpInstance[] = [];

  async function scopeFor(extra: Record<string, unknown>): Promise<Scope> {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'cfg-test', version: '1.0.0' },
      apps: [WebFetchApp],
      ...extra,
    });
    instances.push(instance);
    return instance.getScopes()[0] as Scope;
  }

  afterAll(async () => {
    await Promise.all(instances.map((i) => i.dispose?.()));
  });

  it('defaults to the worker root `/` when http.entryPath is unset (one path, not both)', async () => {
    const handler = createWebFetchHandler(await scopeFor({}));
    expect((await handler(mcpRequestAt('/', INITIALIZE))).status).toBe(200);
    const miss = await handler(mcpRequestAt('/mcp', INITIALIZE));
    expect(miss.status).toBe(404);
    expect((await miss.json()).entryPaths).toEqual(['/']);
  });

  it('serves the single path from http.entryPath (config-driven) and 404s others', async () => {
    const handler = createWebFetchHandler(await scopeFor({ http: { entryPath: '/mcp' } }));
    expect((await handler(mcpRequestAt('/mcp', INITIALIZE))).status).toBe(200);
    expect((await handler(mcpRequestAt('/mcp/', INITIALIZE))).status).toBe(200); // trailing slash normalized
    expect((await handler(mcpRequestAt('/', INITIALIZE))).status).toBe(404);
  });

  it('an explicit entryPath option overrides http.entryPath', async () => {
    const handler = createWebFetchHandler(await scopeFor({ http: { entryPath: '/mcp' } }), { entryPath: '/rpc' });
    expect((await handler(mcpRequestAt('/rpc', INITIALIZE))).status).toBe(200);
    expect((await handler(mcpRequestAt('/mcp', INITIALIZE))).status).toBe(404);
  });

  it('a custom array entryPath option serves only the listed paths', async () => {
    const handler = createWebFetchHandler(await scopeFor({}), { entryPath: ['/rpc', '/mcp'] });
    expect((await handler(mcpRequestAt('/rpc', INITIALIZE))).status).toBe(200);
    expect((await handler(mcpRequestAt('/mcp', INITIALIZE))).status).toBe(200);
    expect((await handler(mcpRequestAt('/', INITIALIZE))).status).toBe(404);
  });

  it('mirrors http.cors → Access-Control-* headers (config-driven CORS)', async () => {
    const handler = createWebFetchHandler(await scopeFor({ http: { cors: { origin: true } } }));
    const preflight = await handler(
      new Request('https://worker.example.com/', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example.com' },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.example.com');

    const res = await handler(
      new Request('https://worker.example.com/', {
        method: 'POST',
        headers: { ...MCP_HEADERS, origin: 'https://app.example.com' },
        body: JSON.stringify(INITIALIZE),
      }),
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('passes http.cors.maxAge to the preflight; no CORS headers when http.cors is unset', async () => {
    const withMaxAge = createWebFetchHandler(await scopeFor({ http: { cors: { origin: '*', maxAge: 600 } } }));
    const preflight = await withMaxAge(new Request('https://worker.example.com/', { method: 'OPTIONS' }));
    expect(preflight.headers.get('access-control-max-age')).toBe('600');

    const noCors = createWebFetchHandler(await scopeFor({}));
    const res = await noCors(
      new Request('https://worker.example.com/', {
        method: 'POST',
        headers: { ...MCP_HEADERS, origin: 'https://app.example.com' },
        body: JSON.stringify(INITIALIZE),
      }),
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('stateless POST buffers JSON regardless of protocol (no session → no SSE; avoids a hung worker)', async () => {
    // Streamable protocol: a STATELESS POST still buffers JSON. With no session
    // there are no server-initiated notifications to stream, and an SSE POST
    // reply would never close — its `ctx.waitUntil` teardown would never settle
    // and the Worker would "hang" until the runtime cancels the request. Only a
    // standalone GET (or a stateful Durable-Object session) opens an SSE stream.
    const streaming = createWebFetchHandler(await scopeFor({}));
    const streamingRes = await streaming(mcpRequestAt('/', INITIALIZE));
    expect(streamingRes.headers.get('content-type')).toContain('application/json');

    // stateless-api: streamable:false → POST returns buffered JSON too.
    const buffered = createWebFetchHandler(await scopeFor({ transport: { protocol: 'stateless-api' } }));
    const jsonRes = await buffered(mcpRequestAt('/', INITIALIZE));
    expect(jsonRes.headers.get('content-type')).toContain('application/json');
  });
});
