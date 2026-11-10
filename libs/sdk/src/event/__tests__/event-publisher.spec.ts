import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, event, EVENT_PUBLISHER, Tool, ToolContext } from '../../common';
import { EventsNotEnabledError } from '../../errors';
import { type Scope } from '../../scope/scope.instance';
import { ScopeEventPublisher } from '../event-publisher';

const orderShipped = event({ name: 'order.shipped', payloadSchema: { orderId: z.string() } });

@Tool({ name: 'ship_order', inputSchema: { orderId: z.string() } })
class ShipOrderTool extends ToolContext {
  async execute({ orderId }: { orderId: string }) {
    const fromContext = await this.events.publish(orderShipped, { orderId });
    const fromToken = await this.get(EVENT_PUBLISHER).publish('order.shipped', { orderId });
    return {
      eventIds: [fromContext.eventId, fromToken.eventId],
      matched: fromContext.matched + fromToken.matched,
      samePublisher: this.get(EVENT_PUBLISHER) === this.events,
    };
  }
}

@App({ id: 'shop', name: 'Shop', tools: [ShipOrderTool], events: [orderShipped] })
class ShopApp {}

@App({ id: 'plain', name: 'Plain', tools: [ShipOrderTool] })
class AppWithoutEvents {}

function scopeOf(server: TestFetchServer): Scope {
  return server.instance.getScopes()[0] as Scope;
}

function structuredResultOf(message: { result?: Record<string, unknown> }): Record<string, unknown> {
  const content = message.result?.['content'] as Array<{ text: string }>;
  return JSON.parse(content[0].text);
}

describe('the event publisher of a server', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'event-publisher', version: '1.0.0' }, apps: [ShopApp] });
  });

  afterAll(async () => {
    await scopeOf(server).dispose();
  });

  it('is scope.events.publisher, and the provider behind EVENT_PUBLISHER', () => {
    const scope = scopeOf(server);

    expect(scope.events?.publisher).toBeInstanceOf(ScopeEventPublisher);
    expect(scope.providers.get(EVENT_PUBLISHER)).toBe(scope.events?.publisher);
  });

  it('is this.events in a tool, and what the token gives it', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/call', {
      name: 'ship_order',
      arguments: { orderId: 'o-1' },
    });

    expect(message.error).toBeUndefined();
    expect(structuredResultOf(message)).toEqual({
      eventIds: [expect.stringMatching(/^evt_/), expect.stringMatching(/^evt_/)],
      matched: 0,
      samePublisher: true,
    });
  });

  it('publishes while the server performs no delivery mode: nobody is subscribed', async () => {
    const scope = scopeOf(server);

    expect(scope.events?.outbox).toBeUndefined();
    await expect(scope.events?.publisher?.publish(orderShipped, { orderId: 'o-2' })).resolves.toMatchObject({
      matched: 0,
    });
  });

  it('refuses to publish on a server without events', async () => {
    const plain = await createTestFetchServer({
      info: { name: 'event-publisher-none', version: '1.0.0' },
      apps: [AppWithoutEvents],
    });
    const scope = scopeOf(plain);

    const { message } = await rpc20260728(plain.handler, 'tools/call', {
      name: 'ship_order',
      arguments: { orderId: 'o-3' },
    });

    expect(scope.events).toBeUndefined();
    expect(message.result?.['isError']).toBe(true);
    expect(JSON.stringify(message.result)).toContain(new EventsNotEnabledError().message);
    await scope.dispose();
  });
});

describe('the outbox health check', () => {
  it('reports the pending deliveries while the store answers, and unhealthy when it does not', async () => {
    const server = await createTestFetchServer({
      info: { name: 'event-outbox-health', version: '1.0.0' },
      apps: [ShopApp],
      auth: { mode: 'local' } as never,
    });
    const scope = scopeOf(server);
    const probe = scope.healthProbes.find((candidate) => candidate.name === 'events-outbox');
    const outbox = scope.events?.outbox;
    if (!probe || !outbox) throw new Error('the scope has no outbox health check');

    await expect(probe.check()).resolves.toEqual({ status: 'healthy', details: { pendingDeliveries: 0 } });

    jest.spyOn(outbox, 'depth').mockRejectedValueOnce(new Error('store down'));
    await expect(probe.check()).resolves.toEqual({ status: 'unhealthy', error: 'store down' });

    jest.spyOn(outbox, 'depth').mockRejectedValueOnce('offline');
    await expect(probe.check()).resolves.toEqual({ status: 'unhealthy', error: 'offline' });
    await scope.dispose();
  });
});
