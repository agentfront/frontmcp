/**
 * `mcp.events` sends the MCP Events requests through the client's transport, holds `events/stream` open over
 * Streamable HTTP, and turns a refusal into an `EventRequestError`.
 */
import { EventRequestError } from '@frontmcp/sdk';

import { StreamableHttpTransport } from '../../transport/streamable-http.transport';
import { McpTestClient } from '../mcp-test-client';

interface JsonRpcRequestBody {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

const SUBSCRIPTION_ID = 'io.modelcontextprotocol/subscriptionId';
const encoder = new TextEncoder();
/** The headers of the last request of each method. */
const headersByMethod = new Map<string, Record<string, string>>();

/** A response whose body is SSE frames of `messages`, left open until `signal` aborts when `keepOpen`. */
function sseResponse(messages: Array<object | string>, signal?: AbortSignal | null, keepOpen = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const message of messages) {
        const data = typeof message === 'string' ? message : JSON.stringify(message);
        controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));
      }
      if (!keepOpen) controller.close();
      else signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A JSON response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Answer the requests of the client as an events server; every request is recorded. */
function stubFetch(): JsonRpcRequestBody[] {
  const requests: JsonRpcRequestBody[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as JsonRpcRequestBody;
    requests.push(body);
    headersByMethod.set(body.method, init?.headers as Record<string, string>);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const reply = (result: unknown) => jsonResponse({ jsonrpc: '2.0', id: body.id, result });
    switch (body.method) {
      case 'initialize':
        return reply({ protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test', version: '1' } });
      case 'subscriptions/listen':
        return reply({});
      case 'server/discover':
        return reply({ supportedVersions: ['2026-07-28'], capabilities: {}, _meta: {} });
      case 'events/list':
        return reply({
          events: [{ name: 'order.created', delivery: ['poll', 'push'], inputSchema: {}, payloadSchema: {} }],
        });
      case 'events/poll':
        if (body.params?.['name'] === 'missing') {
          return jsonResponse({ jsonrpc: '2.0', id: body.id, error: { code: -32023, message: 'Not served' } });
        }
        return reply({ events: [], cursor: 'c0', nextPollMs: 60000 });
      default: {
        const meta = { _meta: { [SUBSCRIPTION_ID]: body.id } };
        return sseResponse(
          [
            { jsonrpc: '2.0', method: 'notifications/events/active', params: { cursor: 'c1', ...meta } },
            {
              jsonrpc: '2.0',
              method: 'notifications/events/event',
              params: { eventId: 'e1', name: 'order.created', timestamp: 't', data: { n: 1 }, cursor: 'c2', ...meta },
            },
          ],
          init?.signal,
          true,
        );
      }
    }
  }) as typeof fetch;
  return requests;
}

describe('McpTestClient events', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('lists the events and pushes over a session, cancelled with notifications/cancelled', async () => {
    const requests = stubFetch();
    const client = McpTestClient.create({ baseUrl: 'http://localhost:3003', publicMode: true }).build();
    await client.connect();

    const listed = await client.events.list();
    const subscription = await client.events.subscribe('order.created');
    const first = await subscription[Symbol.asyncIterator]().next();
    await subscription.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listed.map((definition) => definition.name)).toEqual(['order.created']);
    expect(subscription.mode).toBe('push');
    expect(first.value).toMatchObject({ eventId: 'e1', data: { n: 1 } });
    const stream = requests.find((request) => request.method === 'events/stream');
    expect(requests.at(-1)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: stream?.id },
    });
  });

  it('cancels its subscriptions when it disconnects', async () => {
    const requests = stubFetch();
    const client = McpTestClient.create({ baseUrl: 'http://localhost:3003', publicMode: true }).build();
    await client.connect();
    const subscription = await client.events.subscribe('order.created', {}, { delivery: 'poll' });

    await client.disconnect();
    const pollsAtDisconnect = requests.filter((request) => request.method === 'events/poll').length;

    await expect(subscription[Symbol.asyncIterator]().next()).resolves.toEqual({ value: undefined, done: true });
    expect(pollsAtDisconnect).toBe(1);
  });

  it('cancels a stream by closing it under protocol 2026-07-28', async () => {
    const requests = stubFetch();
    const client = McpTestClient.create({ baseUrl: 'http://localhost:3003', publicMode: true })
      .withProtocolVersion('2026-07-28')
      .build();
    await client.connect();

    const subscription = await client.events.subscribe('order.created');
    await subscription.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(requests.map((request) => request.method)).not.toContain('notifications/cancelled');
    expect(headersByMethod.get('events/stream')).toMatchObject({
      'Mcp-Method': 'events/stream',
      'Mcp-Name': 'order.created',
    });
  });

  it('polls over HTTP+SSE, which cannot hold a stream, and turns a refusal into an EventRequestError', async () => {
    stubFetch();
    const client = new McpTestClient({ baseUrl: 'http://localhost:3003', transport: 'sse' });
    const events = client.events;
    jest.spyOn(client as unknown as { request: () => Promise<unknown> }, 'request').mockResolvedValueOnce({
      success: false,
      error: { code: -32023, message: 'Not served', data: { kind: 'event' } },
    });

    const refused = await events.subscribe('missing', {}, { delivery: 'poll' }).catch((error: unknown) => error);

    expect(client.events).toBe(events);
    expect(refused).toBeInstanceOf(EventRequestError);
    expect(refused).toMatchObject({ rpcCode: -32023, data: { kind: 'event' } });
  });

  it('turns a refused stream into an EventRequestError', async () => {
    stubFetch();
    const client = McpTestClient.create({ baseUrl: 'http://localhost:3003', publicMode: true }).build();
    await client.connect();
    const streamRequest = jest
      .spyOn(StreamableHttpTransport.prototype, 'streamRequest')
      .mockResolvedValueOnce({ jsonrpc: '2.0', id: 1, error: { code: -32024, message: 'Forbidden' } });

    await expect(client.events.subscribe('order.created')).rejects.toMatchObject({ rpcCode: -32024 });
    streamRequest.mockRestore();
  });
});

describe('StreamableHttpTransport.streamRequest', () => {
  const realFetch = globalThis.fetch;
  const message = { jsonrpc: '2.0' as const, id: 9, method: 'events/stream', params: { name: 'x' } };

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** A connected transport whose fetch answers with `answer`. */
  async function transportAnswering(answer: () => Promise<Response>): Promise<StreamableHttpTransport> {
    globalThis.fetch = answer as typeof fetch;
    const transport = new StreamableHttpTransport({ baseUrl: 'http://localhost:3003', publicMode: true });
    await transport.connect();
    return transport;
  }

  it('hands notifications on and resolves with the final frame, skipping what is not JSON-RPC', async () => {
    const notifications: string[] = [];
    const transport = await transportAnswering(async () =>
      sseResponse([
        'not json',
        { jsonrpc: '2.0', method: 'notifications/events/heartbeat', params: {} },
        { jsonrpc: '2.0', id: 9, result: { resultType: 'complete' } },
      ]),
    );

    const final = await transport.streamRequest(
      message,
      (notification) => notifications.push(notification.method),
      new AbortController().signal,
    );

    expect(notifications).toEqual(['notifications/events/heartbeat']);
    expect(final).toEqual({ jsonrpc: '2.0', id: 9, result: { resultType: 'complete' } });
  });

  it('answers a JSON result, a JSON-RPC error and an HTTP error', async () => {
    const answers = [
      jsonResponse({ jsonrpc: '2.0', id: 9, result: {} }),
      jsonResponse({ jsonrpc: '2.0', id: 9, error: { code: -32024, message: 'Forbidden' } }, 403),
      new Response('boom', { status: 500, statusText: 'Server Error' }),
    ];
    const transport = await transportAnswering(async () => answers.shift() as Response);
    const signal = new AbortController().signal;

    const result = await transport.streamRequest(message, () => undefined, signal);
    const refused = await transport.streamRequest(message, () => undefined, signal);
    const failed = await transport.streamRequest(message, () => undefined, signal);

    expect(result).toEqual({ jsonrpc: '2.0', id: 9, result: {} });
    expect(refused?.error).toEqual({ code: -32024, message: 'Forbidden' });
    expect(failed?.error).toEqual({ code: -32000, message: 'HTTP 500: Server Error', data: 'boom' });
  });

  it('resolves with nothing when aborted before an answer, and throws a network failure', async () => {
    const failures = [new DOMException('aborted', 'AbortError'), new TypeError('fetch failed')];
    const transport = await transportAnswering(async () => {
      throw failures.shift();
    });
    const signal = new AbortController().signal;

    await expect(transport.streamRequest(message, () => undefined, signal)).resolves.toBeUndefined();
    await expect(transport.streamRequest(message, () => undefined, signal)).rejects.toThrow('fetch failed');
  });
});
