/**
 * In a browser build without native `AsyncContext`, top-level requests take turns. An open `events/stream` waits for
 * its next notification without holding the turn, so the session keeps answering other requests.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type JSONRPCMessage, type Transport } from '@frontmcp/protocol';

import { createTestFetchServer, type TestFetchServer } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event } from '../../../common';
import { type Scope } from '../../../scope/scope.instance';
import { createInMemoryServer } from '../../in-memory-server';

jest.mock('#async-context', () => jest.requireActual('../../../../../utils/src/async-context/browser-async-context'));

const orderShipped = event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } });

@App({ id: 'shop', name: 'Shop', events: [orderShipped] })
class ShopApp {}

interface WireMessage {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
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
      this.waiting.get(wire.id)?.(wire);
      this.waiting.delete(wire.id);
    };
  }

  /** Open the session. */
  async initialize(): Promise<void> {
    await this.transport.start();
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'raw-session-client', version: '1.0.0' },
    });
    await this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
  }

  /** Send a request and answer its reply. */
  request(method: string, params: Record<string, unknown>): Promise<WireMessage> {
    const id = this.nextId++;
    const reply = new Promise<WireMessage>((resolve) => this.waiting.set(id, resolve));
    void this.transport.send({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage);
    return reply;
  }
}

/** Resolve within `ms`, or reject naming what did not arrive. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} did not arrive in ${ms} ms`)), ms)),
  ]);
}

describe('events/stream in a browser build without AsyncContext', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'events-stream-browser', version: '1.0.0' },
      apps: [ShopApp],
    });
  });

  afterAll(async () => {
    await (server.instance.getScopes()[0] as Scope).dispose();
  });

  it('answers other requests of the session while a stream is open', async () => {
    const inMemory = await createInMemoryServer(server.instance.getScopes()[0] as Scope);
    const client = new RawSessionClient(inMemory.clientTransport);
    await client.initialize();

    void client.request('events/stream', { name: 'order.shipped', cursor: null });
    await within(
      (async () => {
        while (!client.notifications.some((notification) => notification.method === 'notifications/events/active')) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })(),
      1000,
      'notifications/events/active',
    );
    const listed = await within(client.request('events/list', {}), 1000, 'the events/list reply');

    expect(listed.result?.['events']).toEqual([expect.objectContaining({ name: 'order.shipped' })]);
    await inMemory.close();
  });
});
