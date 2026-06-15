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
  return new Request('https://worker.example.com/mcp', {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  });
}

describe('createWebFetchHandler (Cloudflare Worker path)', () => {
  let instance: FrontMcpInstance;
  let handler: WebFetchHandler;

  beforeAll(async () => {
    instance = await FrontMcpInstance.createForGraph({
      info: { name: 'web-fetch-test', version: '1.0.0' },
      apps: [WebFetchApp],
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
    const json = (await res.json()) as {
      result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> };
    };
    expect(json.result?.serverInfo?.name).toBe('web-fetch-test');
    expect(json.result?.capabilities).toBeDefined();
  });

  it('serves tools/list statelessly (fresh transport per request, no session)', async () => {
    const res = await handler(
      mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { result?: { tools?: Array<{ name: string }> } };
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
    const json = (await res.json()) as {
      result?: { content?: Array<{ type: string; text?: string }> };
    };
    expect(json.result?.content?.[0]?.text).toBe('Echo: hi');
  });
});
