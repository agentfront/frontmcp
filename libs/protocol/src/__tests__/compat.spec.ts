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
  ReadResourceRequestSchema,
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

describe('resource not found', () => {
  async function readWith(code: number, version?: string) {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { resources: {} } });
    server.setRequestHandler(ReadResourceRequestSchema, async (request: { params: { uri: string } }) => {
      throw new McpError(code, `Resource not found: ${request.params.uri}`, { uri: request.params.uri });
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const wire: unknown[] = [];
    await server.connect(serverTransport);
    const client = new Client({ name: 'c', version: '1' });
    await client.connect(clientTransport);
    const received = clientTransport.onmessage;
    clientTransport.onmessage = (message, extra) => {
      wire.push(message);
      received?.(message, extra);
    };
    if (version) (server as unknown as { _negotiatedProtocolVersion: string })._negotiatedProtocolVersion = version;
    const failure = await client.readResource({ uri: 'notes://missing' }).catch((error: unknown) => error);
    return { failure: failure as { code: number }, wire: wire as Array<{ error?: { code: number } }> };
  }

  it('answers -32002 on a 2025-era session, and the client keeps it', async () => {
    const { failure, wire } = await readWith(-32002);
    expect(wire[0]?.error?.code).toBe(-32002);
    expect(failure.code).toBe(-32002);
  });

  it('leaves -32602 on a 2026-07-28 session, and other invalid params alone', async () => {
    expect((await readWith(-32002, '2026-07-28')).wire[0]?.error?.code).toBe(-32602);
    const invalid = await readWith(-32602);
    expect(invalid.wire[0]?.error?.code).toBe(-32602);
    expect(invalid.failure.code).toBe(-32602);
  });
});

describe('resource not found across connections', () => {
  const serve = () => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { resources: {}, tools: {} } });
    server.setRequestHandler(ReadResourceRequestSchema, async (request: { params: { uri: string } }) => {
      throw new McpError(-32002, `Resource not found: ${request.params.uri}`, { uri: request.params.uri });
    });
    server.setRequestHandler('tools/list', () => {
      throw 'not an error object';
    });
    return server;
  };

  it('wraps a reused transport once and answers for the server now on it', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await serve().connect(serverTransport);
    const second = serve();
    await second.connect(serverTransport);
    const client = new Client({ name: 'c', version: '1' });
    await client.connect(clientTransport);

    await expect(client.readResource({ uri: 'notes://gone' })).rejects.toMatchObject({ code: -32002 });
    await expect(client.listTools()).rejects.toThrow();

    // Before a version is negotiated the session counts as 2025-era
    (second as unknown as { _negotiatedProtocolVersion?: string })._negotiatedProtocolVersion = undefined;
    await expect(client.readResource({ uri: 'notes://gone' })).rejects.toMatchObject({ code: -32002 });

    // A response to a request nobody waits for still goes to v2's own handling
    const onerror = jest.fn();
    client.onerror = onerror;
    await serverTransport.send({ jsonrpc: '2.0', id: 999, error: { code: -32002, message: 'late' } });
    expect(onerror).toHaveBeenCalled();
    await client.close();
  });
});
