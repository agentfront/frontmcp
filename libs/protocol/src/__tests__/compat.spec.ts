import { PassThrough } from 'node:stream';

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import { internalZ as z } from '@frontmcp/lazy-zod';

import { Client, StreamableHTTPClientTransport } from '../compat-client';
import { ErrorCode, McpError } from '../compat-errors';
import { Server } from '../compat-server';
import { CallToolResultSchema, ToolSchema } from '../compat-types';
import { InMemoryTransport } from '../in-memory';
import {
  CallToolRequestSchema,
  ElicitRequestSchema,
  ElicitResultSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  type InitializeResult,
} from '../index';
import { StdioServerTransport } from '../node-stdio-server';
import type { RequestHandlerExtra } from '../shared';

async function connected(server: Server, client = new Client({ name: 'test-client', version: '1.0.0' })) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe('McpError', () => {
  it('keeps the v1 message and matches every protocol error', () => {
    const error = new McpError(ErrorCode.InvalidParams, 'bad input', { field: 'a' });
    expect(error.message).toBe('MCP error -32602: bad input');
    expect(error.code).toBe(-32602);
    expect(error).toBeInstanceOf(ProtocolError);
    expect(new ProtocolError(ProtocolErrorCode.InternalError, 'boom')).toBeInstanceOf(McpError);
    expect(new Error('plain')).not.toBeInstanceOf(McpError);
  });
});

describe('Server with v1 handlers', () => {
  it('passes a v1 extra built from the v2 context, and records the initialize answer', async () => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const seen: RequestHandlerExtra[] = [];
    server.setRequestHandler(InitializeRequestSchema, async (request: { params: { protocolVersion: string } }) => {
      const result: InitializeResult = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'frontmcp', version: '1.0.0' },
      };
      return result;
    });
    server.setRequestHandler(ListToolsRequestSchema, async (_request: unknown, extra: RequestHandlerExtra) => {
      seen.push(extra);
      return { tools: [] };
    });

    const client = await connected(server, new Client({ name: 'c', version: '2' }, { capabilities: { roots: {} } }));
    await client.listTools();

    expect(seen).toHaveLength(1);
    expect(typeof seen[0].requestId).toBe('number');
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(typeof seen[0].sendNotification).toBe('function');
    expect(server.getClientVersion()).toEqual({ name: 'c', version: '2' });
    expect(server.getClientCapabilities()).toMatchObject({ roots: {} });
    expect(server.getNegotiatedProtocolVersion()).toBe(client.getNegotiatedProtocolVersion());
  });

  it('serves a custom method registered with a v1 schema', async () => {
    const server = new Server({ name: 'test', version: '1.0.0' });
    // A custom method, as FrontMCP registers `skills/search`
    const schema = z.object({ method: z.literal('skills/search'), params: z.object({ query: z.string() }) });
    server.setRequestHandler(schema, async (request: { params: { query: string } }) => ({
      skills: [request.params.query],
    }));
    const client = await connected(server);

    const result = await client.request(
      { method: 'skills/search', params: { query: 'deploy' } },
      { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } },
    );
    expect(result).toEqual({ skills: ['deploy'] });
  });

  it("keeps v1's tools/call result checks", async () => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string } }) =>
      request.params.name === 'bad' ? { content: 'not an array' } : { content: [{ type: 'text', text: 'ok' }] },
    );
    const client = await connected(server);

    await expect(client.callTool({ name: 'good', arguments: {} }, undefined, { timeout: 5_000 })).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
    await expect(client.callTool({ name: 'bad', arguments: {} })).rejects.toThrow('Invalid tools/call result');
  });
});

describe('CallToolResultSchema', () => {
  it('requires an object structuredContent, as on v1', () => {
    expect(CallToolResultSchema.safeParse({ content: [], structuredContent: { a: 1 } }).success).toBe(true);
    expect(CallToolResultSchema.safeParse({ content: [], structuredContent: 'text' }).success).toBe(false);
  });
});

describe('StdioServerTransport', () => {
  it('stays open when stdin ends, so requests still in flight are answered', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = new StdioServerTransport(stdin, stdout);
    const onclose = jest.fn();
    transport.onclose = onclose;
    await transport.start();

    stdin.end();
    await new Promise((resolve) => setImmediate(resolve));

    expect(onclose).not.toHaveBeenCalled();
    await expect(transport.send({ jsonrpc: '2.0', id: 1, result: {} })).resolves.toBeUndefined();
    await transport.close();
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});

describe('v1 request errors', () => {
  it('fails a server request that times out with McpError(RequestTimeout)', async () => {
    const server = new Server({ name: 'test', version: '1.0.0' });
    const client = new Client({ name: 'c', version: '1' }, { capabilities: { elicitation: { form: {} } } });
    client.setRequestHandler(ElicitRequestSchema, () => new Promise(() => undefined));
    await connected(server, client);

    const failure = await server
      .request(
        {
          method: 'elicitation/create',
          params: { message: 'Age?', requestedSchema: { type: 'object', properties: {} } },
        },
        ElicitResultSchema,
        { timeout: 20 },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(McpError);
    expect((failure as McpError).code).toBe(ErrorCode.RequestTimeout);
  });

  it('records the HTTP status of a refused Streamable HTTP request as http.status', async () => {
    const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:1/mcp'), {
      fetch: async () => new Response('busy', { status: 503, statusText: 'Service Unavailable' }),
    });
    await transport.start();

    const failure = await transport
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' })
      .catch((error: unknown) => error as { http?: { status: number } });

    expect(failure).toMatchObject({ http: { status: 503 } });
  });
});

describe('ToolSchema', () => {
  it('requires the properties of an input schema to be schemas, as on v1', () => {
    const tool = (properties: Record<string, unknown>) => ({ name: 't', inputSchema: { type: 'object', properties } });
    expect(ToolSchema.safeParse(tool({ a: { type: 'string' } })).success).toBe(true);
    expect(ToolSchema.safeParse(tool({ a: 'string' })).success).toBe(false);
  });
});
