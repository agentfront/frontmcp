import * as protocol from '../index';
import {
  EVENT_DELIVERY_ERROR_CATEGORIES,
  EVENT_DELIVERY_MODES,
  EventActiveNotificationSchema,
  EventControlEnvelopeSchema,
  EventDefinitionSchema,
  EventDeliveryStatusSchema,
  EventErrorNotificationSchema,
  EventGapEnvelopeSchema,
  EventHeartbeatNotificationSchema,
  EventOccurrenceNotificationSchema,
  EventOccurrenceSchema,
  EVENTS_ERROR_CODES,
  EVENTS_EXTENSION_ID,
  EVENTS_METHODS,
  EVENTS_NOTIFICATIONS,
  EVENTS_SKETCH_ERROR_CODES,
  EventsListChangedNotificationSchema,
  EventTerminatedNotificationSchema,
  ListEventsRequestSchema,
  ListEventsResultSchema,
  MCP_SUBSCRIPTION_ID_HEADER,
  MCP_WEBHOOK_RECEIVER_WELL_KNOWN_PATH,
  PollEventsRequestSchema,
  PollEventsResultSchema,
  StreamEventsRequestSchema,
  StreamEventsResultSchema,
  SubscribeEventRequestSchema,
  SubscribeEventResultSchema,
  UnsubscribeEventRequestSchema,
  UnsubscribeEventResultSchema,
} from '../types-events';

const definition = {
  name: 'incident.created',
  description: 'Fires when an incident is created',
  delivery: ['webhook', 'poll'],
  inputSchema: { type: 'object', properties: { severity: { type: 'string' } } },
  payloadSchema: { type: 'object', properties: { incidentId: { type: 'string' } } },
};

const occurrence = {
  eventId: 'evt_1',
  name: 'incident.created',
  timestamp: '2026-02-19T16:00:00Z',
  data: { incidentId: 'INC-1' },
};

const subscribeParams = {
  name: 'incident.created',
  arguments: { severity: 'P1' },
  delivery: { mode: 'webhook', url: 'https://receiver.example.com/hooks/1', secret: 'whsec_c2VjcmV0' },
};

describe('MCP Events protocol constants', () => {
  it('names the extension, its methods and its notifications', () => {
    expect(EVENTS_EXTENSION_ID).toBe('io.modelcontextprotocol/events');
    expect(Object.values(EVENTS_METHODS)).toEqual([
      'events/list',
      'events/subscribe',
      'events/unsubscribe',
      'events/poll',
      'events/stream',
    ]);
    expect(Object.values(EVENTS_NOTIFICATIONS)).toEqual([
      'notifications/events/list_changed',
      'notifications/events/active',
      'notifications/events/event',
      'notifications/events/error',
      'notifications/events/heartbeat',
      'notifications/events/terminated',
    ]);
  });

  it('numbers the five errors for SEP-3415 and for the design sketch, in the same order', () => {
    expect(EVENTS_ERROR_CODES).toEqual({
      notFound: -32023,
      forbidden: -32024,
      resourceExhausted: -32025,
      unsupported: -32026,
      callbackEndpointError: -32027,
    });
    expect(Object.keys(EVENTS_SKETCH_ERROR_CODES)).toEqual(Object.keys(EVENTS_ERROR_CODES));
    expect(Object.values(EVENTS_SKETCH_ERROR_CODES)).toEqual([-32011, -32012, -32013, -32014, -32015]);
  });

  it('names the webhook header, the receiver document, the delivery modes and the delivery error categories', () => {
    expect(MCP_SUBSCRIPTION_ID_HEADER).toBe('X-MCP-Subscription-Id');
    expect(MCP_WEBHOOK_RECEIVER_WELL_KNOWN_PATH).toBe('/.well-known/mcp-webhook-receiver.json');
    expect(EVENT_DELIVERY_MODES).toEqual(['poll', 'push', 'webhook']);
    expect(EVENT_DELIVERY_ERROR_CATEGORIES).toEqual([
      'connection_refused',
      'timeout',
      'tls_error',
      'http_4xx',
      'http_5xx',
      'challenge_failed',
    ]);
  });

  it('is exported from the package root', () => {
    expect(protocol.EVENTS_EXTENSION_ID).toBe(EVENTS_EXTENSION_ID);
    expect(protocol.ListEventsRequestSchema).toBe(ListEventsRequestSchema);
  });
});

describe('events/list', () => {
  it('accepts a request without params, with a cursor and with a null cursor', () => {
    expect(ListEventsRequestSchema.safeParse({ method: 'events/list' }).success).toBe(true);
    expect(ListEventsRequestSchema.parse({ method: 'events/list', params: { cursor: 'page-2' } }).params).toEqual({
      cursor: 'page-2',
    });
    expect(ListEventsRequestSchema.safeParse({ method: 'events/list', params: { cursor: null } }).success).toBe(true);
    expect(ListEventsRequestSchema.safeParse({ method: 'events/poll' }).success).toBe(false);
  });

  it('keeps the request _meta a 2026-07-28 client sends', () => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };

    expect(ListEventsRequestSchema.parse({ method: 'events/list', params: { _meta: meta } }).params?._meta).toEqual(
      meta,
    );
  });

  it('parses a page of event definitions', () => {
    const result = ListEventsResultSchema.parse({ events: [definition], nextCursor: 'page-2', resultType: 'complete' });

    expect(result).toEqual({ events: [definition], nextCursor: 'page-2', resultType: 'complete' });
  });

  it('refuses a definition without a delivery mode, with an unknown one, or without a schema', () => {
    expect(EventDefinitionSchema.safeParse({ ...definition, delivery: [] }).success).toBe(false);
    expect(EventDefinitionSchema.safeParse({ ...definition, delivery: ['email'] }).success).toBe(false);
    expect(EventDefinitionSchema.safeParse({ ...definition, payloadSchema: undefined }).success).toBe(false);
    expect(EventDefinitionSchema.safeParse({ ...definition, description: undefined }).success).toBe(true);
  });
});

describe('event occurrences', () => {
  it.each([[undefined], [null], ['cursor_1']])('accepts the cursor %p', (cursor) => {
    expect(EventOccurrenceSchema.safeParse({ ...occurrence, cursor }).success).toBe(true);
  });

  it('requires eventId, name, timestamp and an object as data', () => {
    for (const field of ['eventId', 'name', 'timestamp', 'data']) {
      expect(EventOccurrenceSchema.safeParse({ ...occurrence, [field]: undefined }).success).toBe(false);
    }
    expect(EventOccurrenceSchema.safeParse({ ...occurrence, data: 'text' }).success).toBe(false);
  });
});

describe('events/subscribe', () => {
  it('accepts a webhook subscription with and without a mode, a cursor and a TTL', () => {
    const delivery = { url: subscribeParams.delivery.url, secret: subscribeParams.delivery.secret };

    expect(SubscribeEventRequestSchema.safeParse({ method: 'events/subscribe', params: subscribeParams }).success).toBe(
      true,
    );
    expect(
      SubscribeEventRequestSchema.safeParse({
        method: 'events/subscribe',
        params: { name: 'incident.created', delivery, cursor: null, maxAgeMs: 300000, ttlMs: null },
      }).success,
    ).toBe(true);
    expect(
      SubscribeEventRequestSchema.safeParse({
        method: 'events/subscribe',
        params: { ...subscribeParams, ttlMs: 3600000 },
      }).success,
    ).toBe(true);
  });

  it('refuses a subscription without a secret, with an unknown mode or with a fractional TTL', () => {
    const { secret: _secret, ...withoutSecret } = subscribeParams.delivery;
    const invalid = [
      { ...subscribeParams, delivery: withoutSecret },
      { ...subscribeParams, delivery: { ...subscribeParams.delivery, mode: 'email' } },
      { ...subscribeParams, ttlMs: 1.5 },
      { ...subscribeParams, name: undefined },
    ];

    for (const params of invalid) {
      expect(SubscribeEventRequestSchema.safeParse({ method: 'events/subscribe', params }).success).toBe(false);
    }
  });

  it('requires an id and a refreshBefore that may be null in the result', () => {
    const granted = { id: 'sub_1', refreshBefore: '2026-02-19T17:00:00Z', cursor: null, truncated: false };

    expect(SubscribeEventResultSchema.parse(granted)).toEqual(granted);
    expect(SubscribeEventResultSchema.safeParse({ id: 'sub_1', refreshBefore: null }).success).toBe(true);
    expect(SubscribeEventResultSchema.safeParse({ id: 'sub_1' }).success).toBe(false);
  });

  it('reports delivery status with a fixed error category', () => {
    const failing = {
      active: false,
      lastDeliveryAt: '2026-02-19T15:45:00Z',
      lastError: 'http_4xx',
      failedSince: '2026-02-19T15:50:00Z',
    };

    expect(EventDeliveryStatusSchema.parse(failing)).toEqual(failing);
    expect(EventDeliveryStatusSchema.safeParse({ active: true, lastError: null, throttled: true }).success).toBe(true);
    expect(EventDeliveryStatusSchema.safeParse({ active: true, lastError: '503 Service Unavailable' }).success).toBe(
      false,
    );
    expect(EventDeliveryStatusSchema.safeParse({ lastError: null }).success).toBe(false);
  });
});

describe('events/unsubscribe', () => {
  it('names the subscription by event, arguments and callback URL', () => {
    const params = {
      name: 'incident.created',
      arguments: { severity: 'P1' },
      delivery: { url: 'https://r.example/h' },
    };

    expect(UnsubscribeEventRequestSchema.safeParse({ method: 'events/unsubscribe', params }).success).toBe(true);
    expect(
      UnsubscribeEventRequestSchema.safeParse({ method: 'events/unsubscribe', params: { name: 'incident.created' } })
        .success,
    ).toBe(false);
    expect(UnsubscribeEventResultSchema.parse({})).toEqual({});
  });
});

describe('events/poll and events/stream', () => {
  it('accepts a poll with or without a cursor and bounds', () => {
    expect(
      PollEventsRequestSchema.safeParse({ method: 'events/poll', params: { name: 'email.received' } }).success,
    ).toBe(true);
    expect(
      PollEventsRequestSchema.safeParse({
        method: 'events/poll',
        params: { name: 'email.received', arguments: {}, cursor: null, maxAgeMs: 0, maxEvents: 50 },
      }).success,
    ).toBe(true);
    expect(
      PollEventsRequestSchema.safeParse({ method: 'events/poll', params: { name: 'email.received', maxEvents: 0 } })
        .success,
    ).toBe(false);
  });

  it('parses a poll result with and without a cursor', () => {
    const page = { events: [occurrence], cursor: 'history_2', truncated: false, hasMore: false, nextPollMs: 30000 };

    expect(PollEventsResultSchema.parse(page)).toEqual(page);
    expect(PollEventsResultSchema.safeParse({ events: [] }).success).toBe(true);
    expect(PollEventsResultSchema.safeParse({ events: [], cursor: null }).success).toBe(true);
    expect(PollEventsResultSchema.safeParse({ cursor: null }).success).toBe(false);
  });

  it('accepts a stream request and its empty result', () => {
    expect(
      StreamEventsRequestSchema.safeParse({
        method: 'events/stream',
        params: { name: 'email.received', arguments: { from: '*@example.com' }, cursor: null, maxAgeMs: 300000 },
      }).success,
    ).toBe(true);
    expect(StreamEventsRequestSchema.safeParse({ method: 'events/stream', params: {} }).success).toBe(false);
    expect(StreamEventsResultSchema.parse({ resultType: 'complete' })).toEqual({ resultType: 'complete' });
  });
});

describe('events notifications', () => {
  const meta = { 'io.modelcontextprotocol/subscriptionId': 1 };
  const error = { code: -32024, message: 'Forbidden', data: { reason: 'Access revoked' } };

  it('parses each notification of a push stream', () => {
    const notifications: Array<[{ safeParse(value: unknown): { success: boolean } }, unknown]> = [
      [EventActiveNotificationSchema, { cursor: 'history_1', truncated: false, _meta: meta }],
      [EventActiveNotificationSchema, { _meta: meta }],
      [EventOccurrenceNotificationSchema, { ...occurrence, cursor: null, _meta: meta }],
      [EventErrorNotificationSchema, { error: { code: -32603, message: 'UpstreamError' }, _meta: meta }],
      [EventHeartbeatNotificationSchema, { cursor: null, _meta: meta }],
      [EventHeartbeatNotificationSchema, { _meta: meta }],
      [EventTerminatedNotificationSchema, { error, _meta: meta }],
    ];
    const methods = [
      'notifications/events/active',
      'notifications/events/active',
      'notifications/events/event',
      'notifications/events/error',
      'notifications/events/heartbeat',
      'notifications/events/heartbeat',
      'notifications/events/terminated',
    ];

    notifications.forEach(([schema, params], index) => {
      expect(schema.safeParse({ method: methods[index], params }).success).toBe(true);
      expect(schema.safeParse({ method: 'notifications/events/unknown', params }).success).toBe(false);
    });
  });

  it('parses list_changed without params', () => {
    expect(EventsListChangedNotificationSchema.safeParse({ method: 'notifications/events/list_changed' }).success).toBe(
      true,
    );
  });

  it('requires an error on error and terminated notifications', () => {
    expect(
      EventTerminatedNotificationSchema.safeParse({ method: 'notifications/events/terminated', params: {} }).success,
    ).toBe(false);
    expect(
      EventErrorNotificationSchema.safeParse({
        method: 'notifications/events/error',
        params: { error: { message: 'no code' } },
      }).success,
    ).toBe(false);
  });
});

describe('webhook control envelopes', () => {
  it('tells verification, gap and terminated envelopes apart by type', () => {
    expect(EventControlEnvelopeSchema.parse({ type: 'verification', challenge: 'nonce' })).toEqual({
      type: 'verification',
      challenge: 'nonce',
    });
    expect(EventControlEnvelopeSchema.parse({ type: 'gap', cursor: 'fresh' })).toEqual({
      type: 'gap',
      cursor: 'fresh',
    });
    expect(
      EventControlEnvelopeSchema.safeParse({ type: 'terminated', error: { code: -32023, message: 'NotFound' } })
        .success,
    ).toBe(true);
  });

  it('accepts a gap without a cursor and refuses an unknown type or an event occurrence', () => {
    expect(EventGapEnvelopeSchema.safeParse({ type: 'gap' }).success).toBe(true);
    expect(EventGapEnvelopeSchema.safeParse({ type: 'gap', cursor: null }).success).toBe(true);
    expect(EventControlEnvelopeSchema.safeParse({ type: 'verification' }).success).toBe(false);
    expect(EventControlEnvelopeSchema.safeParse({ type: 'paused' }).success).toBe(false);
    expect(EventControlEnvelopeSchema.safeParse(occurrence).success).toBe(false);
  });
});
