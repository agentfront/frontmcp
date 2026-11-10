/**
 * `events/list` answers over a session opened with `initialize` and under protocol 2026-07-28, and only on a server
 * that offers an event in a delivery mode it performs.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { ListEventsRequestSchema, type JSONRPCMessage, type Transport } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Event, event, EventContext } from '../../../common';
import { type Scope } from '../../../scope/scope.instance';
import { createInMemoryServer } from '../../in-memory-server';
import { createMcpHandlers } from '../index';
import { type McpHandlerOptions } from '../mcp-handlers.types';

@Event({
  name: 'order.created',
  description: 'Fires when an order is placed',
  inputSchema: { status: z.string().optional() },
  payloadSchema: { orderId: z.string() },
})
class OrderCreated extends EventContext {}

const orderShipped = event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } });

@App({ id: 'shop', name: 'Shop', events: [orderShipped, OrderCreated] })
class ShopApp {}

const serverConfig = { info: { name: 'events-list-handler', version: '1.0.0' }, apps: [ShopApp] };

type JsonRpcReply = {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
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

describe('events/list', () => {
  let serving: TestFetchServer;
  let idle: TestFetchServer;

  beforeAll(async () => {
    serving = await createTestFetchServer(serverConfig);
    scopeOf(serving).events?.enableDeliveryMode('webhook');
    idle = await createTestFetchServer(serverConfig);
  });

  afterAll(async () => {
    await scopeOf(serving).dispose();
    await scopeOf(idle).dispose();
  });

  describe('over a session opened with initialize', () => {
    async function openSession(server: TestFetchServer) {
      const inMemory = await createInMemoryServer(scopeOf(server));
      const client = new RawSessionClient(inMemory.clientTransport);
      const initialized = await client.initialize();
      return { client, initialized, close: inMemory.close };
    }

    it('advertises events top-level and as the SEP-3415 extension', async () => {
      const { initialized, close } = await openSession(serving);
      const capabilities = initialized.result?.['capabilities'] as Record<string, unknown>;

      expect(capabilities['events']).toEqual({});
      expect(capabilities['extensions']).toMatchObject({ 'io.modelcontextprotocol/events': {} });
      await close();
    });

    it('answers the event definitions, ordered by name, without a resultType', async () => {
      const { client, close } = await openSession(serving);

      const reply = await client.request('events/list', {});

      expect(reply.error).toBeUndefined();
      expect(reply.result).toEqual({
        events: [
          expect.objectContaining({
            name: 'order.created',
            description: 'Fires when an order is placed',
            delivery: ['webhook'],
            inputSchema: expect.objectContaining({ type: 'object', properties: { status: { type: 'string' } } }),
            payloadSchema: expect.objectContaining({ type: 'object', required: ['orderId'] }),
          }),
          expect.objectContaining({ name: 'order.shipped', delivery: ['webhook'] }),
        ],
      });
      await close();
    });

    it('answers a request without params', async () => {
      const { client, close } = await openSession(serving);

      const reply = await client.request('events/list');

      expect((reply.result?.['events'] as unknown[]).length).toBe(2);
      await close();
    });

    it('answers Method not found, and advertises nothing, while no delivery mode is enabled', async () => {
      const { client, initialized, close } = await openSession(idle);
      const capabilities = initialized.result?.['capabilities'] as Record<string, unknown>;

      const reply = await client.request('events/list', {});

      expect(capabilities['events']).toBeUndefined();
      expect(capabilities['extensions']).toBeUndefined();
      expect(reply.error?.code).toBe(-32601);
      await close();
    });
  });

  describe('under protocol 2026-07-28', () => {
    it('answers with resultType complete and no cache hints', async () => {
      const { status, message } = await rpc20260728(serving.handler, 'events/list', {});

      expect(status).toBe(200);
      expect(message.error).toBeUndefined();
      expect(message.result?.['resultType']).toBe('complete');
      expect(message.result).not.toHaveProperty('ttlMs');
      expect(message.result).not.toHaveProperty('cacheScope');
      expect((message.result?.['events'] as Array<{ name: string }>).map((definition) => definition.name)).toEqual([
        'order.created',
        'order.shipped',
      ]);
    });

    it('accepts a null cursor as the first page', async () => {
      const { message } = await rpc20260728(serving.handler, 'events/list', { cursor: null });

      expect((message.result?.['events'] as unknown[]).length).toBe(2);
    });

    it('refuses params that are not a list request', async () => {
      const { message } = await rpc20260728(serving.handler, 'events/list', { cursor: 5 });

      expect(message.error?.code).toBe(-32602);
    });

    it('advertises events in server/discover, top-level and as the SEP-3415 extension', async () => {
      const { message } = await rpc20260728(serving.handler, 'server/discover', {});
      const capabilities = message.result?.['capabilities'] as Record<string, unknown>;

      expect(capabilities['events']).toEqual({});
      expect(capabilities['extensions']).toMatchObject({ 'io.modelcontextprotocol/events': {} });
    });

    it('answers Method not found, and advertises nothing, while no delivery mode is enabled', async () => {
      const listed = await rpc20260728(idle.handler, 'events/list', {});
      const discovered = await rpc20260728(idle.handler, 'server/discover', {});
      const capabilities = discovered.message.result?.['capabilities'] as Record<string, Record<string, unknown>>;

      expect(listed.status).toBe(404);
      expect(listed.message.error?.code).toBe(-32601);
      expect(capabilities['events']).toBeUndefined();
      expect(capabilities['extensions']).not.toHaveProperty('io.modelcontextprotocol/events');
    });
  });

  describe('handler registration', () => {
    const logger = { child: () => logger, verbose: jest.fn() };

    function handlerSchemas(events?: { servesEvents(): boolean }) {
      const options = {
        serverOptions: { capabilities: {} },
        scope: { logger, events },
      } as unknown as McpHandlerOptions;
      return createMcpHandlers(options).map((handler) => handler.requestSchema);
    }

    it('registers events/list only on a scope that serves events', () => {
      expect(handlerSchemas({ servesEvents: () => true })).toContain(ListEventsRequestSchema);
      expect(handlerSchemas({ servesEvents: () => false })).not.toContain(ListEventsRequestSchema);
      expect(handlerSchemas()).not.toContain(ListEventsRequestSchema);
    });
  });
});
