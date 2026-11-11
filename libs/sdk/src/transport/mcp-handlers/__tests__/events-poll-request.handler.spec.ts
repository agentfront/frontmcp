/** `events/poll` answers over a session opened with `initialize` and under protocol 2026-07-28, on a public server. */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { PollEventsRequestSchema, type JSONRPCMessage, type Transport } from '@frontmcp/protocol';

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

@App({ id: 'shop', name: 'Shop', events: [orderShipped] })
class ShopApp {}

type JsonRpcReply = {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

/** A session-era client that reads the replies as they are on the wire. */
class RawSessionClient {
  private nextId = 1;
  private readonly waiting = new Map<number, (reply: JsonRpcReply) => void>();

  constructor(private readonly transport: Transport) {
    transport.onmessage = (message) => {
      const reply = message as JsonRpcReply & { id?: number };
      if (reply.id === undefined) return;
      this.waiting.get(reply.id)?.(reply);
      this.waiting.delete(reply.id);
    };
  }

  async initialize(): Promise<JsonRpcReply> {
    await this.transport.start();
    const reply = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'raw-session-client', version: '1.0.0' },
    });
    await this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return reply;
  }

  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcReply> {
    const id = this.nextId++;
    const reply = new Promise<JsonRpcReply>((resolve) => this.waiting.set(id, resolve));
    void this.transport.send({ jsonrpc: '2.0', id, method, ...(params && { params }) } as JSONRPCMessage);
    return reply;
  }
}

function scopeOf(server: TestFetchServer): Scope {
  return server.instance.getScopes()[0] as Scope;
}

describe('events/poll', () => {
  let server: TestFetchServer;

  async function ship(orderId: string): Promise<void> {
    await scopeOf(server).events?.publisher?.publish(orderShipped, { orderId });
  }

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'events-poll-handler', version: '1.0.0' }, apps: [ShopApp] });
  });

  afterAll(async () => {
    await scopeOf(server).dispose();
  });

  describe('over a session opened with initialize', () => {
    async function openSession() {
      const inMemory = await createInMemoryServer(scopeOf(server));
      const client = new RawSessionClient(inMemory.clientTransport);
      const initialized = await client.initialize();
      return { client, initialized, close: inMemory.close };
    }

    it('advertises events on a public server, which offers them by poll', async () => {
      const { client, initialized, close } = await openSession();
      const capabilities = initialized.result?.['capabilities'] as Record<string, unknown>;

      const listed = await client.request('events/list', {});

      expect(capabilities['events']).toEqual({});
      expect(listed.result?.['events']).toEqual([
        expect.objectContaining({ name: 'order.shipped', delivery: ['poll'] }),
      ]);
      await close();
    });

    it('answers the position for a null cursor, then what was published since', async () => {
      const { client, close } = await openSession();

      const start = await client.request('events/poll', { name: 'order.shipped', cursor: null });
      await ship('o-1');
      const next = await client.request('events/poll', { name: 'order.shipped', cursor: start.result?.['cursor'] });

      expect(start.result).toEqual({
        events: [],
        cursor: expect.any(String),
        truncated: false,
        hasMore: false,
        nextPollMs: 30_000,
      });
      expect(next.result?.['events']).toEqual([
        {
          eventId: expect.stringMatching(/^evt_/),
          name: 'order.shipped',
          timestamp: expect.any(String),
          data: { orderId: 'o-1' },
        },
      ]);
      await close();
    });

    it('answers a refusal with its events code, and invalid arguments as invalid params', async () => {
      const { client, close } = await openSession();

      const unknown = await client.request('events/poll', { name: 'order.refunded' });
      const invalid = await client.request('events/poll', { name: 'order.shipped', arguments: { anything: 1 } });

      expect(unknown.error).toMatchObject({ code: -32023, data: { kind: 'event' } });
      expect(invalid.error).toMatchObject({ code: -32602 });
      await close();
    });
  });

  describe('under protocol 2026-07-28', () => {
    it('answers with resultType complete, and drains with the cursor it returned', async () => {
      const start = await rpc20260728(server.handler, 'events/poll', { name: 'order.shipped' });
      await ship('o-2');
      await ship('o-3');
      const cursor = start.message.result?.['cursor'];

      const first = await rpc20260728(server.handler, 'events/poll', { name: 'order.shipped', cursor, maxEvents: 1 });
      const second = await rpc20260728(server.handler, 'events/poll', {
        name: 'order.shipped',
        cursor: first.message.result?.['cursor'],
      });

      expect(start.message.result).toMatchObject({ resultType: 'complete', events: [], truncated: false });
      expect(first.message.result).toMatchObject({ resultType: 'complete', hasMore: true });
      expect(first.message.result?.['events']).toEqual([expect.objectContaining({ data: { orderId: 'o-2' } })]);
      expect(second.message.result).toMatchObject({ hasMore: false });
      expect(second.message.result?.['events']).toEqual([expect.objectContaining({ data: { orderId: 'o-3' } })]);
    });

    it('answers a cursor of another process with truncated and a fresh cursor', async () => {
      const { message } = await rpc20260728(server.handler, 'events/poll', {
        name: 'order.shipped',
        cursor: 'ffffffffffffffffffffffffffffffff.3',
      });

      expect(message.error).toBeUndefined();
      expect(message.result).toMatchObject({ events: [], truncated: true });
    });

    it('requires the Mcp-Name header to name the event, and refuses params that are not a poll request', async () => {
      const mismatched = await rpc20260728(
        server.handler,
        'events/poll',
        { name: 'order.shipped' },
        { headers: { 'mcp-name': 'another.event' } },
      );
      const invalid = await rpc20260728(server.handler, 'events/poll', { name: 'order.shipped', maxEvents: 0 });

      expect(mismatched.message.error?.message).toContain("does not match body value 'order.shipped'");
      expect(invalid.message.error).toMatchObject({ code: -32602 });
    });
  });

  describe('handler registration', () => {
    function schemasOf(scope: Scope) {
      const options = { scope, serverOptions: {} } as McpHandlerOptions;
      return createMcpHandlers(options).map((handler) => handler.requestSchema);
    }

    it('registers events/poll on a server that performs the poll mode only', async () => {
      const disabled = await createTestFetchServer({
        info: { name: 'events-poll-off', version: '1.0.0' },
        apps: [ShopApp],
        events: { poll: { enabled: false } },
      });

      expect(schemasOf(scopeOf(server))).toContain(PollEventsRequestSchema);
      expect(schemasOf(scopeOf(disabled))).not.toContain(PollEventsRequestSchema);
      await scopeOf(disabled).dispose();
    });
  });
});
