import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import type { EventOccurrence } from '@frontmcp/protocol';

import { App, event, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import {
  EventRequestError,
  EventSubscriptionTerminatedError,
  NoCompatibleDeliveryModeError,
  type EventSubscription,
} from '../../event-client';
import type { DirectClient } from '../client.types';
import { connect } from '../connect';

const orderPlaced = event({
  name: 'order.placed',
  inputSchema: { status: z.string().optional() },
  payloadSchema: { orderId: z.string(), status: z.string() },
  match(occurrence, args) {
    return args.status === undefined || args.status === occurrence.data.status;
  },
});

const pollOnly = event({
  name: 'report.ready',
  payloadSchema: { reportId: z.string() },
  delivery: ['poll'],
});

@Tool({ name: 'place_order', inputSchema: { orderId: z.string(), status: z.string().default('paid') } })
class PlaceOrderTool extends ToolContext {
  async execute(input: { orderId: string; status: string }) {
    return this.events.publish(orderPlaced, input);
  }
}

@App({ id: 'shop', name: 'Shop', tools: [PlaceOrderTool], events: [orderPlaced, pollOnly] })
class ShopApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'direct-events', version: '1.0.0' },
  apps: [ShopApp],
  logging: { level: LogLevel.Off },
  events: { push: { heartbeatMs: 100 }, poll: { nextPollMs: 30 } },
};

/** The next `count` occurrences of a subscription. */
async function take(subscription: EventSubscription, count: number): Promise<EventOccurrence[]> {
  const taken: EventOccurrence[] = [];
  const iterator = subscription[Symbol.asyncIterator]();
  while (taken.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    taken.push(next.value);
  }
  return taken;
}

describe('DirectClient events', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect(config, {
      session: { id: 'direct-events', user: { sub: 'ada' } },
      events: { pollFloorMs: 20 },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('lists the event types with their delivery modes', async () => {
    const events = await client.events.list();

    expect(events.map((definition) => [definition.name, definition.delivery])).toEqual([
      ['order.placed', ['poll', 'push']],
      ['report.ready', ['poll']],
    ]);
  });

  it('subscribes by push over the in-process connection and yields what a tool publishes', async () => {
    const subscription = await client.events.subscribe('order.placed', { status: 'paid' });

    await client.callTool('place_order', { orderId: 'o-1', status: 'refunded' });
    await client.callTool('place_order', { orderId: 'o-2' });
    const [occurrence] = await take(subscription, 1);
    await subscription.cancel();

    expect(subscription.mode).toBe('push');
    expect(occurrence).toMatchObject({ name: 'order.placed', data: { orderId: 'o-2', status: 'paid' } });
    expect(subscription.cursor).toEqual(expect.any(String));
  });

  it('polls when asked to, and the iteration ends on cancel', async () => {
    const subscription = await client.events.subscribe('order.placed', {}, { delivery: 'poll' });
    await client.callTool('place_order', { orderId: 'o-3' });

    const [occurrence] = await take(subscription, 1);
    await subscription.cancel();
    const after = await subscription[Symbol.asyncIterator]().next();

    expect(subscription.mode).toBe('poll');
    expect(occurrence.data).toEqual({ orderId: 'o-3', status: 'paid' });
    expect(after.done).toBe(true);
  });

  it('polls an event offered by poll only', async () => {
    const subscription = await client.events.subscribe('report.ready');

    expect(subscription.mode).toBe('poll');
    await subscription.cancel();
  });

  it('refuses a mode the event does not offer, and a webhook without a receiver', async () => {
    await expect(client.events.subscribe('report.ready', {}, { delivery: 'push' })).rejects.toBeInstanceOf(
      NoCompatibleDeliveryModeError,
    );
    await expect(client.events.subscribe('order.placed', {}, { delivery: 'webhook' })).rejects.toBeInstanceOf(
      NoCompatibleDeliveryModeError,
    );
  });

  it('rejects with the JSON-RPC error of a refused stream and of a refused poll', async () => {
    const stream = client.events.subscribe('order.unknown', {}, { delivery: 'push' });
    const poll = client.events.subscribe('order.placed', { status: 7 }, { delivery: 'poll' });

    await expect(stream).rejects.toMatchObject({ rpcCode: -32023, method: 'events/stream' });
    await expect(poll).rejects.toBeInstanceOf(EventRequestError);
    await expect(poll).rejects.toMatchObject({ rpcCode: -32602 });
  });

  it('exports the terminated error for a subscription the server ends', () => {
    const terminated = new EventSubscriptionTerminatedError('order.placed', { code: -32024, message: 'Forbidden' });

    expect(terminated.message).toContain('order.placed');
    expect(terminated.error.code).toBe(-32024);
  });
});
