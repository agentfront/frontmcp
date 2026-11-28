import { SdkError, SdkErrorCode, type BaseContext } from '@modelcontextprotocol/server';

import { internalZ as z } from '@frontmcp/lazy-zod';

import { Client, StreamableHTTPClientTransport } from '../compat-client';
import { ErrorCode, McpError, toV1RequestError } from '../compat-errors';
import {
  adaptNotificationHandler,
  isMethodSchema,
  methodOfSchema,
  toV1Extra,
  withTransportInfo,
} from '../compat-handlers';
import { Server } from '../compat-server';
import { JSONRPCErrorSchema } from '../compat-types';
import { InMemoryTransport } from '../in-memory';
import {
  CallToolRequestSchema,
  JSONRPCErrorResponseSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '../index';
import * as types from '../types';

const passThrough = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const;

async function connected(server: Server, client = new Client({ name: 'test-client', version: '1.0.0' })) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function contextOf(overrides: Partial<BaseContext['mcpReq']> = {}, signal = new AbortController().signal): BaseContext {
  return {
    sessionId: 'session-1',
    mcpReq: {
      id: 7,
      method: 'tools/call',
      _meta: { progressToken: 1 },
      signal,
      requestState: (() => undefined) as never,
      send: jest.fn(async () => ({ ok: true })) as never,
      notify: jest.fn(async () => undefined),
      ...overrides,
    },
  };
}

describe('the v1 handler helpers', () => {
  it('reads the method of a schema from its literal value or its enum values', () => {
    const parse = (value: unknown) => value;
    expect(methodOfSchema({ shape: { method: { value: 'tools/list' } }, parse })).toBe('tools/list');
    expect(methodOfSchema({ shape: { method: { _def: { values: ['events/list'] } } }, parse })).toBe('events/list');
    expect(() => methodOfSchema({ shape: {}, parse })).toThrow('Schema is missing a method literal');
    expect(isMethodSchema('tools/list')).toBe(false);
    expect(isMethodSchema(ListToolsRequestSchema)).toBe(true);
  });

  it('builds the v1 extra from the context and what the transport passed', () => {
    const ctx = contextOf();
    const closeSSEStream = jest.fn();
    const authInfo = { token: 't', clientId: 'c', scopes: [] };
    const extra = toV1Extra(
      withTransportInfo(ctx, { requestInfo: { headers: { a: '1' } }, authInfo, closeSSEStream }) as BaseContext,
    );

    expect(extra).toMatchObject({
      sessionId: 'session-1',
      requestId: 7,
      _meta: { progressToken: 1 },
      authInfo,
      requestInfo: { headers: { a: '1' } },
      closeSSEStream,
    });
  });

  it('reads the request info from a web Request when the transport passed one', () => {
    const request = new Request('http://localhost/mcp?x=1', { headers: { 'x-trace': 'abc' } });
    const extra = toV1Extra(withTransportInfo(contextOf(), { request }) as BaseContext);
    expect(extra.requestInfo?.headers['x-trace']).toBe('abc');
    expect(extra.requestInfo?.url?.searchParams.get('x')).toBe('1');
    expect(toV1Extra(contextOf()).requestInfo).toBeUndefined();
  });

  it('sends notifications and requests until the request is cancelled', async () => {
    const live = contextOf();
    const extra = toV1Extra(live);
    await extra.sendNotification({ method: 'notifications/progress', params: { progressToken: 1, progress: 1 } });
    expect(live.mcpReq.notify).toHaveBeenCalledTimes(1);
    await expect(extra.sendRequest({ method: 'ping' }, passThrough as never)).resolves.toEqual({ ok: true });

    const controller = new AbortController();
    const cancelled = contextOf({}, controller.signal);
    controller.abort();
    const cancelledExtra = toV1Extra(cancelled);
    await cancelledExtra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken: 1, progress: 1 },
    });
    expect(cancelled.mcpReq.notify).not.toHaveBeenCalled();
    await expect(cancelledExtra.sendRequest({ method: 'ping' }, passThrough as never)).rejects.toMatchObject({
      code: ErrorCode.ConnectionClosed,
    });
  });

  it('fails a request the handler sends as v1 did when it times out', async () => {
    const timedOut = contextOf({
      send: (async () => {
        throw new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out', { timeout: 5 });
      }) as never,
    });
    await expect(toV1Extra(timedOut).sendRequest({ method: 'ping' }, passThrough as never)).rejects.toMatchObject({
      code: ErrorCode.RequestTimeout,
      message: 'MCP error -32001: Request timed out',
    });
  });

  it('parses a notification with the v1 schema', async () => {
    const handler = jest.fn();
    await adaptNotificationHandler(RootsListChangedNotificationSchema, handler)(
      {},
      { jsonrpc: '2.0', method: 'notifications/roots/list_changed' },
    );
    expect(handler).toHaveBeenCalledWith({ method: 'notifications/roots/list_changed' });
  });
});

describe('the v1 errors', () => {
  it('rebuilds a protocol error from a code, and keeps instanceof exact for subclasses', () => {
    const rebuilt = McpError.fromError(ErrorCode.InvalidParams, 'bad');
    expect(rebuilt).toBeInstanceOf(McpError);
    expect(rebuilt.code).toBe(ErrorCode.InvalidParams);

    class NotFound extends McpError {}
    expect(new NotFound(-32002, 'missing')).toBeInstanceOf(NotFound);
    expect(new McpError(-32002, 'missing')).not.toBeInstanceOf(NotFound);
  });

  it('maps only the timeouts and closed connections of v2 to v1 codes', () => {
    const plain = new Error('plain');
    expect(toV1RequestError(plain)).toBe(plain);
    const notConnected = new SdkError(SdkErrorCode.NotConnected, 'Not connected');
    expect(toV1RequestError(notConnected)).toBe(notConnected);
    const closed = toV1RequestError(new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'));
    expect(closed).toMatchObject({ code: ErrorCode.ConnectionClosed });
    expect((closed as Error).cause).toBeInstanceOf(SdkError);
  });

  it('keeps the v1 name of the JSON-RPC error schema', () => {
    expect(JSONRPCErrorSchema).toBe(JSONRPCErrorResponseSchema);
  });
});

describe('Server registration forms', () => {
  it('keeps the v2 forms for method names', async () => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const initialized = jest.fn();
    server.setNotificationHandler('notifications/initialized', initialized);
    server.setRequestHandler('tools/list', () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }));
    const client = await connected(server);

    await expect(client.listTools()).resolves.toMatchObject({ tools: [{ name: 'echo' }] });
    await new Promise((resolve) => setImmediate(resolve));
    expect(initialized).toHaveBeenCalledTimes(1);
  });

  it('runs a v1 notification handler with the parsed notification', async () => {
    const server = new Server({ name: 'test', version: '1.0.0' });
    const changed = jest.fn();
    server.setNotificationHandler(RootsListChangedNotificationSchema, changed);
    const client = await connected(
      server,
      new Client({ name: 'c', version: '1' }, { capabilities: { roots: { listChanged: true } } }),
    );

    await client.sendRootsListChanged();
    await new Promise((resolve) => setImmediate(resolve));
    expect(changed).toHaveBeenCalledWith({ method: 'notifications/roots/list_changed' });
  });

  it('checks a task-augmented tools/call result as a CreateTaskResult, and refuses a malformed request', async () => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const now = new Date().toISOString();
    server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string } }) =>
      request.params.name === 'ok'
        ? { task: { taskId: 't1', status: 'working', ttl: 1000, createdAt: now, lastUpdatedAt: now } }
        : { content: [] },
    );
    const client = await connected(server);
    const call = (params: Record<string, unknown>) =>
      client.request({ method: 'tools/call', params }, passThrough as never);

    await expect(call({ name: 'ok', arguments: {}, task: { ttl: 1000 } })).resolves.toMatchObject({
      task: { taskId: 't1' },
    });
    await expect(call({ name: 'bad', arguments: {}, task: { ttl: 1000 } })).rejects.toThrow(
      'Invalid task creation result',
    );
    await expect(call({ arguments: {} })).rejects.toThrow('Invalid tools/call request');
  });
});

describe('Client registration forms and callTool arguments', () => {
  it('runs v1 and v2 notification handlers', async () => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } });
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [] }));
    const client = new Client({ name: 'c', version: '1' });
    const v1 = jest.fn();
    const v2 = jest.fn();
    client.setNotificationHandler(ToolListChangedNotificationSchema, v1);
    client.setNotificationHandler('notifications/message', v2);
    await connected(server, client);

    await server.sendToolListChanged();
    await new Promise((resolve) => setImmediate(resolve));
    expect(v1).toHaveBeenCalledWith({ method: 'notifications/tools/list_changed' });
  });

  it('answers a server request through a v2 handler, and takes callTool options in either position', async () => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    const client = new Client({ name: 'c', version: '1' }, { capabilities: { roots: {} } });
    client.setRequestHandler('roots/list', () => ({ roots: [{ uri: 'file:///work' }] }));
    await connected(server, client);

    await expect(server.listRoots()).resolves.toEqual({ roots: [{ uri: 'file:///work' }] });
    const schema = z.object({ content: z.array(z.unknown()) });
    await expect(client.callTool({ name: 'echo', arguments: {} }, schema, { timeout: 5_000 })).resolves.toMatchObject({
      content: [{ text: 'ok' }],
    });
    await expect(client.callTool({ name: 'echo', arguments: {} }, { timeout: 5_000 })).resolves.toMatchObject({
      content: [{ text: 'ok' }],
    });
  });

  it('passes on an HTTP client failure that has no status as it is', async () => {
    const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:1/mcp'), {
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await transport.start();
    const failure = await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }).catch((error: unknown) => error);
    expect(failure).not.toHaveProperty('http');
  });
});

describe('the types module', () => {
  it('exports the runtime constants and guards it names', () => {
    for (const [name, value] of Object.entries(types)) {
      expect(value).toBeDefined();
      expect(name).toBeTruthy();
    }
    expect(types.LATEST_PROTOCOL_VERSION).toBe('2025-11-25');
    expect(types.isJSONRPCRequest({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(true);
  });
});
