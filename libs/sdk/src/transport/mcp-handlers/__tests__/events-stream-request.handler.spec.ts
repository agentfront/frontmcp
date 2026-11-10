/** `events/stream` stays open over a session opened with `initialize`, and is an SSE response under 2026-07-28. */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  PROTOCOL_2026_07_28,
  StreamEventsRequestSchema,
  type JSONRPCMessage,
  type Transport,
} from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event } from '../../../common';
import { type Scope } from '../../../scope/scope.instance';
import { createInMemoryServer } from '../../in-memory-server';
import { createMcpHandlers } from '../index';
import { type McpHandlerOptions } from '../mcp-handlers.types';

const orderShipped = event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } });
const auditLogged = event({ name: 'audit.logged', payloadSchema: { action: z.string() }, authorities: 'admin' });

@App({ id: 'shop', name: 'Shop', events: [orderShipped, auditLogged] })
class ShopApp {}

interface WireMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

/** A session-era client that keeps the notifications it receives beside the replies. */
class RawSessionClient {
  readonly notifications: WireMessage[] = [];
  private nextId = 1;
  private readonly waiting = new Map<number, (reply: WireMessage) => void>();

  constructor(private readonly transport: Transport) {
    transport.onmessage = (message) => {
      const wire = message as WireMessage;
      if (wire.id === undefined) {
        this.notifications.push(wire);
        return;
      }
      this.waiting.get(wire.id as number)?.(wire);
      this.waiting.delete(wire.id as number);
    };
  }

  async initialize(): Promise<void> {
    await this.transport.start();
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'raw-session-client', version: '1.0.0' },
    }).reply;
    await this.notify('notifications/initialized');
  }

  request(method: string, params: Record<string, unknown>): { id: number; reply: Promise<WireMessage> } {
    const id = this.nextId++;
    const reply = new Promise<WireMessage>((resolve) => this.waiting.set(id, resolve));
    void this.transport.send({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage);
    return { id, reply };
  }

  notify(method: string, params?: Record<string, unknown>): Promise<void> {
    return this.transport.send({ jsonrpc: '2.0', method, ...(params && { params }) } as JSONRPCMessage);
  }

  async waitForNotifications(count: number): Promise<WireMessage[]> {
    const deadline = Date.now() + 3000;
    while (this.notifications.length < count) {
      if (Date.now() > deadline) throw new Error(`${this.notifications.length} of ${count} notifications arrived`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return this.notifications;
  }
}

function scopeOf(server: TestFetchServer): Scope {
  return server.instance.getScopes()[0] as Scope;
}

/** Reads the JSON-RPC messages of an SSE body until `count` arrived. */
async function readFrames(reader: ReadableStreamDefaultReader<Uint8Array>, count: number): Promise<WireMessage[]> {
  const decoder = new TextDecoder();
  const messages: WireMessage[] = [];
  let text = '';
  while (messages.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    const frames = text.split('\n\n');
    text = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      if (data) messages.push(JSON.parse(data.slice('data: '.length)));
    }
  }
  return messages;
}

describe('events/stream', () => {
  let server: TestFetchServer;

  async function ship(orderId: string): Promise<void> {
    await scopeOf(server).events?.publisher?.publish(orderShipped, { orderId });
  }

  function streamRequest(params: Record<string, unknown>, id: number | string | null = 41): Request {
    return new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': 'events/stream',
        ...(typeof params['name'] === 'string' && { 'mcp-name': params['name'] }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(id !== null && { id }),
        method: 'events/stream',
        params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL_2026_07_28 } },
      }),
    });
  }

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'events-stream-handler', version: '1.0.0' },
      apps: [ShopApp],
      authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
    });
  });

  afterAll(async () => {
    await scopeOf(server).dispose();
  });

  describe('over a session opened with initialize', () => {
    async function openSession() {
      const inMemory = await createInMemoryServer(scopeOf(server));
      const client = new RawSessionClient(inMemory.clientTransport);
      await client.initialize();
      return { client, close: inMemory.close };
    }

    it('confirms, delivers what is published, and ends when the request is cancelled', async () => {
      const { client, close } = await openSession();

      const { id } = client.request('events/stream', { name: 'order.shipped' });
      await client.waitForNotifications(1);
      await ship('o-1');
      const [active, delivered] = await client.waitForNotifications(2);
      await client.notify('notifications/cancelled', { requestId: id });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(active).toMatchObject({
        method: 'notifications/events/active',
        params: { truncated: false, _meta: { 'io.modelcontextprotocol/subscriptionId': id } },
      });
      expect(delivered).toMatchObject({
        method: 'notifications/events/event',
        params: {
          name: 'order.shipped',
          data: { orderId: 'o-1' },
          _meta: { 'io.modelcontextprotocol/subscriptionId': id },
        },
      });
      expect(scopeOf(server).events?.streams?.size).toBe(0);
      await close();
    });

    it('answers with the final frame when the server ends the stream', async () => {
      const { client, close } = await openSession();
      const { id, reply } = client.request('events/stream', { name: 'order.shipped' });
      await client.waitForNotifications(1);

      await scopeOf(server).events?.streams?.stop();
      const final = await reply;

      expect(final.result).toEqual({ _meta: { 'io.modelcontextprotocol/subscriptionId': id } });
      await close();
    });

    it('answers a refusal with its events code and opens no stream', async () => {
      const { client, close } = await openSession();

      const unknown = await client.request('events/stream', { name: 'order.refunded' }).reply;
      const forbidden = await client.request('events/stream', { name: 'audit.logged' }).reply;

      expect(unknown.error).toMatchObject({ code: -32023, data: { kind: 'event' } });
      expect(forbidden.error).toMatchObject({ code: -32024 });
      expect(client.notifications).toEqual([]);
      await close();
    });
  });

  describe('under protocol 2026-07-28', () => {
    it('answers with an SSE stream: active, the events, and nothing more once the client stops reading', async () => {
      const response = await server.handler(streamRequest({ name: 'order.shipped' }));
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();

      const [active] = await readFrames(reader, 1);
      await ship('o-2');
      const [delivered] = await readFrames(reader, 1);
      await reader.cancel();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(active).toMatchObject({
        jsonrpc: '2.0',
        method: 'notifications/events/active',
        params: { truncated: false, _meta: { 'io.modelcontextprotocol/subscriptionId': 41 } },
      });
      expect(delivered).toMatchObject({
        method: 'notifications/events/event',
        params: { data: { orderId: 'o-2' }, _meta: { 'io.modelcontextprotocol/subscriptionId': 41 } },
      });
      expect(scopeOf(server).events?.streams?.size).toBe(0);
    });

    it('ends with the empty result when the server ends the stream', async () => {
      const response = await server.handler(streamRequest({ name: 'order.shipped' }, 'stream-7'));
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      await readFrames(reader, 1);

      await scopeOf(server).events?.streams?.stop();
      const [final] = await readFrames(reader, 1);

      expect(final).toEqual({
        jsonrpc: '2.0',
        id: 'stream-7',
        result: { resultType: 'complete', _meta: { 'io.modelcontextprotocol/subscriptionId': 'stream-7' } },
      });
    });

    it('answers a refusal as a JSON-RPC error, not as a stream', async () => {
      const unknown = await server.handler(streamRequest({ name: 'order.refunded' }));
      const forbidden = await server.handler(streamRequest({ name: 'audit.logged' }));
      const invalid = await server.handler(streamRequest({ name: 'order.shipped', maxAgeMs: -1 }));

      expect(unknown.headers.get('content-type')).toContain('application/json');
      await expect(unknown.json()).resolves.toMatchObject({ id: 41, error: { code: -32023 } });
      await expect(forbidden.json()).resolves.toMatchObject({ error: { code: -32024 } });
      await expect(invalid.json()).resolves.toMatchObject({ error: { code: -32602 } });
    });
  });

  describe('where the push mode is off', () => {
    it('registers no handler and answers Method not found', async () => {
      const disabled = await createTestFetchServer({
        info: { name: 'events-stream-off', version: '1.0.0' },
        apps: [ShopApp],
        authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
        events: { push: { enabled: false } },
      });
      const schemasOf = (scope: Scope) =>
        createMcpHandlers({ scope, serverOptions: {} } as McpHandlerOptions).map((handler) => handler.requestSchema);

      const reply = await rpc20260728(disabled.handler, 'events/stream', { name: 'order.shipped' });

      expect(schemasOf(scopeOf(server))).toContain(StreamEventsRequestSchema);
      expect(schemasOf(scopeOf(disabled))).not.toContain(StreamEventsRequestSchema);
      expect(reply.message.error).toMatchObject({ code: -32601 });
      await scopeOf(disabled).dispose();
    });
  });
});
