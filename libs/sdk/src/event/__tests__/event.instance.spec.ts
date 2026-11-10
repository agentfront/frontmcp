import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Event, event, EventContext, Provider, type EventOccurrenceOf, type EventSubscriber } from '../../common';
import { type FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { type EventInstance } from '../event.instance';

type OrderPayload = { orderId: string; status: string };
type OrderArgs = { status?: string };

@Provider({ name: 'order-policy' })
class OrderPolicy {
  allows(status: string | undefined, orderStatus: string): boolean {
    return status === undefined || status === orderStatus;
  }
}

@Event({
  name: 'order.created',
  description: 'Fires when an order is placed',
  inputSchema: { status: z.string().optional().describe('Only orders in this status') },
  payloadSchema: { orderId: z.string(), status: z.string() },
  tags: ['orders', 'sales'],
  authorities: { guards: [() => true] },
})
class OrderCreated extends EventContext<OrderArgs, OrderPayload> {
  override match(orderEvent: EventOccurrenceOf<OrderPayload>, args: OrderArgs) {
    return this.get(OrderPolicy).allows(args.status, orderEvent.data.status);
  }
}

const orderShipped = event({
  name: 'order.shipped',
  inputSchema: z.object({ carrier: z.string() }),
  payloadSchema: z.object({ orderId: z.string(), carrier: z.string() }),
  match(orderEvent, args) {
    return this.metadata.name === 'order.shipped' && orderEvent.data.carrier === args.carrier;
  },
});

const orderArchived = event({ name: 'order.archived', payloadSchema: { orderId: z.string() } });
const orderCancelled = event({ name: 'order.cancelled', payloadSchema: { orderId: z.string() } });

@App({
  id: 'orders',
  name: 'Orders',
  providers: [OrderPolicy],
  events: [OrderCreated, orderShipped, orderArchived, orderCancelled],
})
class OrdersApp {}

const subscriber: EventSubscriber = { sub: 'alice', roles: [], permissions: [], scopes: [], claims: {} };

function occurrence<Data>(name: string, data: Data): EventOccurrenceOf<Data> {
  return { eventId: 'evt_1', name, timestamp: '2026-02-19T16:00:00Z', data };
}

describe('EventInstance', () => {
  let instance: FrontMcpInstance;
  let scope: Scope;

  function eventNamed(name: string): EventInstance {
    const found = scope.events?.findByName(name);
    if (!found) throw new Error(`event ${name} is not registered`);
    return found;
  }

  beforeAll(async () => {
    ({ instance } = await createTestFetchServer({
      info: { name: 'event-instance', version: '1.0.0' },
      apps: [OrdersApp],
      authorities: {},
    }));
    scope = instance.getScopes()[0] as Scope;
  });

  afterAll(async () => {
    await scope.dispose();
  });

  it('names the event, its owner, its tags and its authorities', () => {
    const created = eventNamed('order.created');

    expect(created.name).toBe('order.created');
    expect(created.fullName).toBe(`${created.owner.id}:order.created`);
    expect(created.providers).toBe(scope.apps.getApps()[0].providers);
    expect(created.getTags()).toEqual(['orders', 'sales']);
    expect(created.getAuthorities()).toEqual({ guards: [expect.any(Function)] });
    expect(eventNamed('order.archived').getTags()).toEqual([]);
    expect(eventNamed('order.archived').getAuthorities()).toBeUndefined();
  });

  describe('JSON Schemas', () => {
    it('converts a raw shape inputSchema as tools do', () => {
      expect(eventNamed('order.created').getInputJsonSchema()).toEqual({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { status: { type: 'string', description: 'Only orders in this status' } },
      });
    });

    it('converts a z.object() inputSchema', () => {
      expect(eventNamed('order.shipped').getInputJsonSchema()).toMatchObject({
        type: 'object',
        properties: { carrier: { type: 'string' } },
        required: ['carrier'],
      });
    });

    it('advertises an empty closed object for an event without inputSchema', () => {
      expect(eventNamed('order.archived').getInputJsonSchema()).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
    });

    it('converts the payloadSchema, from a raw shape and from z.object()', () => {
      expect(eventNamed('order.created').getPayloadJsonSchema()).toEqual({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { orderId: { type: 'string' }, status: { type: 'string' } },
        required: ['orderId', 'status'],
        additionalProperties: false,
      });
      expect(eventNamed('order.shipped').getPayloadJsonSchema()).toMatchObject({
        type: 'object',
        properties: { orderId: { type: 'string' }, carrier: { type: 'string' } },
        required: ['orderId', 'carrier'],
      });
    });

    it('converts each schema once', () => {
      const created = eventNamed('order.created');

      expect(created.getInputJsonSchema()).toBe(created.getInputJsonSchema());
      expect(created.getPayloadJsonSchema()).toBe(created.getPayloadJsonSchema());
    });

    it('gives each event without inputSchema a schema of its own', () => {
      const archived = eventNamed('order.archived').getInputJsonSchema();
      const cancelled = eventNamed('order.cancelled').getInputJsonSchema();

      expect(cancelled).toEqual(archived);
      expect(cancelled).not.toBe(archived);
    });
  });

  describe('create()', () => {
    it("builds the @Event class with its app's providers", async () => {
      const context = eventNamed('order.created').create({});

      expect(context).toBeInstanceOf(OrderCreated);
      expect(context.metadata.name).toBe('order.created');
      expect(context.get(OrderPolicy)).toBeInstanceOf(OrderPolicy);
      const paid = occurrence('order.created', { orderId: 'o-1', status: 'paid' });
      expect(await context.match?.(paid, { status: 'paid' }, subscriber)).toBe(true);
      expect(await context.match?.(paid, { status: 'open' }, subscriber)).toBe(false);
    });

    it('leaves the methods a class does not declare undefined', () => {
      const context = eventNamed('order.created').create({});

      expect(context.authorize).toBeUndefined();
      expect(context.transform).toBeUndefined();
      expect(context.check).toBeUndefined();
      expect(context.onSubscribe).toBeUndefined();
      expect(context.onUnsubscribe).toBeUndefined();
    });

    it('builds a context for an event() function whose methods run on it', async () => {
      const context = eventNamed('order.shipped').create({});

      expect(context).toBeInstanceOf(EventContext);
      const shipped = occurrence('order.shipped', { orderId: 'o-1', carrier: 'dhl' });
      expect(await context.match?.(shipped, { carrier: 'dhl' }, subscriber)).toBe(true);
      expect(await context.match?.(shipped, { carrier: 'ups' }, subscriber)).toBe(false);
      expect(context.transform).toBeUndefined();
    });

    it('builds a context for an event() function without methods', () => {
      const context = eventNamed('order.archived').create({ sessionId: 'session-1' });

      expect(context.match).toBeUndefined();
      expect(context.authInfo).toEqual({ sessionId: 'session-1' });
      expect(context.scope).toBe(scope);
    });
  });
});
