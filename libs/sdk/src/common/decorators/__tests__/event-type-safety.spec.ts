import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  Event,
  event,
  EventContext,
  type EventInputOf,
  type EventOccurrenceOf,
  type EventPayloadOf,
  type EventPublisher,
  type EventSubscriber,
} from '../../';

// ════════════════════════════════════════════════════════════════
// Type-level tests: verified by `nx typecheck sdk`
//
// Each [ts-expect-error] MUST correspond to an actual type error.
// Invalid usages are wrapped in never-called functions so nothing
// runs at decoration time.
// ════════════════════════════════════════════════════════════════

type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;

function assertType<_Check extends true>(): void {
  return undefined;
}

type OrderArgs = { status?: string | undefined };
type OrderPayload = { orderId: string; total: number };

const inputSchema = { status: z.string().optional() };
const payloadSchema = { orderId: z.string(), total: z.number() };

// ── Valid: a class that leaves the EventContext types at their defaults ──

@Event({ name: 'order.untyped', inputSchema, payloadSchema })
class UntypedOrderEvent extends EventContext {}

// ── Valid: a class that declares the types its schemas describe ──

@Event({ name: 'order.typed', inputSchema, payloadSchema })
class TypedOrderEvent extends EventContext<OrderArgs, OrderPayload> {
  override match(orderEvent: EventOccurrenceOf<OrderPayload>, args: OrderArgs, subscriber: EventSubscriber) {
    return subscriber.roles.includes('sales') && (args.status === undefined || orderEvent.data.total > 0);
  }
}

// ── Valid: an event without arguments declares none ──

@Event({ name: 'order.no-args', payloadSchema: z.object({ orderId: z.string() }) })
class NoArgsOrderEvent extends EventContext<Record<string, never>, { orderId: string }> {}

// ── Valid: event() infers the types of its methods from its schemas ──

const orderShipped = event({
  name: 'order.shipped',
  inputSchema,
  payloadSchema,
  match(orderEvent, args) {
    assertType<Equal<typeof orderEvent.data, OrderPayload>>();
    assertType<Equal<typeof args, OrderArgs>>();
    return this.metadata.name === 'order.shipped';
  },
});

const orderArchived = event({ name: 'order.archived', payloadSchema: { orderId: z.string() } });

// ── The types a publisher reads from an event ──

assertType<Equal<EventPayloadOf<typeof orderShipped>, OrderPayload>>();
assertType<Equal<EventInputOf<typeof orderShipped>, OrderArgs>>();
assertType<Equal<EventInputOf<typeof orderArchived>, Record<string, never>>>();
assertType<Equal<EventPayloadOf<typeof TypedOrderEvent>, OrderPayload>>();
assertType<Equal<EventInputOf<typeof TypedOrderEvent>, OrderArgs>>();
assertType<Equal<EventPayloadOf<typeof UntypedOrderEvent>, Record<string, unknown>>>();
assertType<Equal<EventPayloadOf<{ payloadSchema: typeof payloadSchema }>, OrderPayload>>();
assertType<Equal<EventInputOf<{ inputSchema: typeof inputSchema; payloadSchema: typeof payloadSchema }>, OrderArgs>>();
assertType<Equal<EventInputOf<{ payloadSchema: typeof payloadSchema }>, Record<string, never>>>();

// ── Invalid: the class does not extend EventContext ──

function _testClassMustExtendEventContext() {
  // @ts-expect-error - a class decorated with @Event must extend EventContext
  @Event({ name: 'order.plain', payloadSchema })
  class PlainOrderEvent {}
  void PlainOrderEvent;
}

// ── Invalid: the declared payload type is not the payloadSchema's ──

function _testDeclaredPayloadMustMatchSchema() {
  // @ts-expect-error - EventContext declares { orderId: number }, the schema says { orderId: string; total: number }
  @Event({ name: 'order.wrong-payload', payloadSchema })
  class WrongPayloadEvent extends EventContext<Record<string, unknown>, { orderId: number }> {}
  void WrongPayloadEvent;
}

// ── Invalid: the declared arguments type is not the inputSchema's ──

function _testDeclaredArgumentsMustMatchSchema() {
  // @ts-expect-error - EventContext declares { status: number }, the schema says { status?: string }
  @Event({ name: 'order.wrong-args', inputSchema, payloadSchema })
  class WrongArgsEvent extends EventContext<{ status: number }, OrderPayload> {}
  void WrongArgsEvent;
}

// ── Invalid: arguments declared for an event without an inputSchema ──

function _testArgumentsNeedAnInputSchema() {
  // @ts-expect-error - without an inputSchema a subscription takes no arguments
  @Event({ name: 'order.undeclared-args', payloadSchema })
  class UndeclaredArgsEvent extends EventContext<{ status: string }, OrderPayload> {}
  void UndeclaredArgsEvent;
}

// ── Invalid: schemas that are not objects ──

function _testSchemasMustBeObjects() {
  // @ts-expect-error - payloadSchema must be a raw shape or z.object()
  event({ name: 'order.text', payloadSchema: z.string() });
  // @ts-expect-error - inputSchema must be a raw shape or z.object()
  event({ name: 'order.list', inputSchema: z.array(z.string()), payloadSchema });
}

// ── Invalid: a method of event() that does not fit the schemas ──

function _testBuilderMethodsFollowTheSchemas() {
  event({
    name: 'order.bad-match',
    payloadSchema,
    // @ts-expect-error - match() returns a boolean
    match: () => 'yes',
  });
}

// ── publish(): data has the type of the event's payload ──

async function _testPublishTakesThePayloadOfTheEvent(publisher: EventPublisher) {
  await publisher.publish(TypedOrderEvent, { orderId: 'o-1', total: 10 });
  await publisher.publish(orderShipped, { orderId: 'o-1', total: 10 });
  await publisher.publish(UntypedOrderEvent, { anything: true });
  await publisher.publish('order.created', { anything: true }, { audience: { roles: { any: ['admin'] } } });

  // @ts-expect-error - total is a number
  await publisher.publish(TypedOrderEvent, { orderId: 'o-1', total: 'ten' });

  // @ts-expect-error - total is required
  await publisher.publish(orderShipped, { orderId: 'o-1' });

  // @ts-expect-error - a subscription id is a string
  await publisher.publish('order.created', {}, { subscriptionId: 7 });
}

describe('@Event and event() type safety', () => {
  it('keeps the valid declarations usable at runtime', () => {
    expect([UntypedOrderEvent, TypedOrderEvent, NoArgsOrderEvent].every((cls) => typeof cls === 'function')).toBe(true);
    expect(typeof orderShipped).toBe('function');
    expect(typeof orderArchived).toBe('function');
  });

  it('never runs the invalid declarations', () => {
    const neverCalled = [
      _testClassMustExtendEventContext,
      _testDeclaredPayloadMustMatchSchema,
      _testDeclaredArgumentsMustMatchSchema,
      _testArgumentsNeedAnInputSchema,
      _testSchemasMustBeObjects,
      _testBuilderMethodsFollowTheSchemas,
      _testPublishTakesThePayloadOfTheEvent,
    ];

    expect(neverCalled).toHaveLength(7);
  });
});
