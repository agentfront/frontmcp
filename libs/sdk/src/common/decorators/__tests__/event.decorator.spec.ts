import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Event, event, EventContext, FrontMcpEvent, frontMcpEvent, Tool, ToolContext } from '../../';
import { InvalidDecoratorMetadataError } from '../../../errors';
import { type EventMetadata } from '../../metadata/event.metadata';
import { annotatedFrontMcpEventsSchema } from '../../schemas';
import { FrontMcpEventTokens } from '../../tokens';
import { isEventClass, isEventFunction } from '../event.decorator';

const payloadSchema = { orderId: z.string() };

@Event({
  name: 'order.created',
  description: 'Fires when an order is placed',
  payloadSchema,
  delivery: ['webhook'],
  tags: ['orders'],
})
class OrderCreated extends EventContext {}

@Tool({ name: 'place_order', inputSchema: {} })
class PlaceOrderTool extends ToolContext {
  async execute() {
    return { placed: true };
  }
}

function metadataOf(target: object): EventMetadata {
  return Reflect.getMetadata(FrontMcpEventTokens.metadata, target) as EventMetadata;
}

describe('@Event', () => {
  it('marks the class as an event and keeps its validated metadata', () => {
    expect(isEventClass(OrderCreated)).toBe(true);
    expect(isEventFunction(OrderCreated)).toBe(false);
    expect(metadataOf(OrderCreated)).toEqual({
      name: 'order.created',
      description: 'Fires when an order is placed',
      payloadSchema,
      delivery: ['webhook'],
      tags: ['orders'],
      hideFromDiscovery: false,
    });
  });

  it('is also exported as FrontMcpEvent', () => {
    expect(FrontMcpEvent).toBe(Event);
    expect(frontMcpEvent).toBe(event);
  });

  it('names the field of invalid metadata', () => {
    const declare = () => {
      @Event({ name: 'order created', payloadSchema })
      class SpacedName extends EventContext {}
      return SpacedName;
    };

    expect(declare).toThrow(InvalidDecoratorMetadataError);
    expect(declare).toThrow(
      '@Event invalid metadata for "name": An event name must not contain whitespace or control characters',
    );
  });

  it('refuses metadata without a payloadSchema', () => {
    const declare = () => {
      @Event({ name: 'order.created' } as never)
      class NoPayload extends EventContext {}
      return NoPayload;
    };

    expect(declare).toThrow('@Event invalid metadata for "payloadSchema"');
  });

  it('does not take a class without the decorator for an event', () => {
    class Undecorated extends EventContext {}

    expect(isEventClass(Undecorated)).toBe(false);
    expect(isEventClass('order.created')).toBe(false);
    expect(isEventFunction('order.created')).toBe(false);
  });
});

describe('event()', () => {
  it('returns a function that carries the metadata and the methods given beside it', () => {
    const match = () => true;
    const onSubscribe = () => undefined;

    const orderShipped = event({ name: 'order.shipped', payloadSchema, tags: ['orders'], match, onSubscribe });

    expect(isEventFunction(orderShipped)).toBe(true);
    expect(isEventClass(orderShipped)).toBe(false);
    expect((orderShipped as unknown as Record<symbol, unknown>)[FrontMcpEventTokens.metadata]).toEqual({
      name: 'order.shipped',
      payloadSchema,
      tags: ['orders'],
      hideFromDiscovery: false,
    });
    expect(orderShipped()).toEqual({
      authorize: undefined,
      match,
      transform: undefined,
      check: undefined,
      onSubscribe,
      onUnsubscribe: undefined,
    });
  });

  it('names the field of invalid metadata', () => {
    expect(() => event({ name: '', payloadSchema })).toThrow(InvalidDecoratorMetadataError);
    expect(() => event({ name: '', payloadSchema })).toThrow(
      '@Event invalid metadata for "name": An event name must not be empty',
    );
    expect(() => event({ name: 'order.shipped', payloadSchema, delivery: [] })).toThrow(
      '@Event invalid metadata for "delivery": delivery must name at least one mode',
    );
  });
});

describe('@App({ events })', () => {
  const orderShipped = event({ name: 'order.shipped', payloadSchema });

  it('takes @Event classes and event() functions', () => {
    expect(annotatedFrontMcpEventsSchema.safeParse(OrderCreated).success).toBe(true);
    expect(annotatedFrontMcpEventsSchema.safeParse(orderShipped).success).toBe(true);

    @App({ id: 'orders', name: 'Orders', events: [OrderCreated, orderShipped] })
    class OrdersApp {}

    expect(typeof OrdersApp).toBe('function');
  });

  it.each([
    ['a tool class', PlaceOrderTool],
    ['a plain function', () => undefined],
    ['an event name', 'order.created'],
    ['a metadata object', { name: 'order.created', payloadSchema }],
  ])('refuses %s', (_label, item) => {
    expect(annotatedFrontMcpEventsSchema.safeParse(item).error?.issues[0].message).toBe(
      'events items must be annotated with @Event() or use event() builder.',
    );
  });

  it('fails the app declaration that lists something else', () => {
    const declare = () => {
      @App({ id: 'orders', name: 'Orders', events: [PlaceOrderTool] })
      class BadOrdersApp {}
      return BadOrdersApp;
    };

    expect(declare).toThrow('events items must be annotated with @Event() or use event() builder.');
  });
});
