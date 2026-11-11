import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { Event, event, EventContext, EventKind, type EventRecord } from '../../common';
import { InvalidEntityError } from '../../errors';
import { normalizeEvent } from '../event.utils';

const payloadSchema = { orderId: z.string() };

@Event({ name: 'order.created', payloadSchema })
class OrderCreated extends EventContext {}

const orderShipped = event({ name: 'order.shipped', payloadSchema, match: () => true });

describe('normalizeEvent', () => {
  it('makes a class record of an @Event class', () => {
    const record = normalizeEvent(OrderCreated);

    expect(record.kind).toBe(EventKind.CLASS_TOKEN);
    expect(record.provide).toBe(OrderCreated);
    expect(record.metadata).toMatchObject({ name: 'order.created', payloadSchema, hideFromDiscovery: false });
  });

  it('makes a function record of what event() returns', () => {
    const record = normalizeEvent(orderShipped);

    expect(record.kind).toBe(EventKind.FUNCTION);
    expect(record.provide).toBe(orderShipped);
    expect(record.metadata).toMatchObject({ name: 'order.shipped', payloadSchema });
  });

  it('returns a record as it is', () => {
    const record: EventRecord = normalizeEvent(OrderCreated);

    expect(normalizeEvent(record)).toBe(record);
  });

  it('refuses a class without @Event, naming it', () => {
    class PlainOrder {}

    expect(() => normalizeEvent(PlainOrder)).toThrow(InvalidEntityError);
    expect(() => normalizeEvent(PlainOrder)).toThrow(
      "Invalid event 'PlainOrder'. Expected a class decorated with @Event() or what event() returns.",
    );
  });

  it('refuses anything else', () => {
    expect(() => normalizeEvent('order.created' as never)).toThrow("Invalid event 'order.created'.");
    expect(() => normalizeEvent((() => undefined) as never)).toThrow(InvalidEntityError);
  });
});
