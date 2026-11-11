/** MCP Events extension (SEP-3415, Draft), which `@modelcontextprotocol/sdk` does not ship yet. */
import { internalZ as z } from '@frontmcp/lazy-zod';

export const EVENTS_EXTENSION_ID = 'io.modelcontextprotocol/events' as const;

export const EVENTS_METHODS = {
  list: 'events/list',
  subscribe: 'events/subscribe',
  unsubscribe: 'events/unsubscribe',
  poll: 'events/poll',
  stream: 'events/stream',
} as const;

export const EVENTS_NOTIFICATIONS = {
  listChanged: 'notifications/events/list_changed',
  active: 'notifications/events/active',
  event: 'notifications/events/event',
  error: 'notifications/events/error',
  heartbeat: 'notifications/events/heartbeat',
  terminated: 'notifications/events/terminated',
} as const;

/** SEP-3415: NotFound, Forbidden, ResourceExhausted, Unsupported, CallbackEndpointError. */
export const EVENTS_ERROR_CODES = {
  notFound: -32023,
  forbidden: -32024,
  resourceExhausted: -32025,
  unsupported: -32026,
  callbackEndpointError: -32027,
} as const;

/** The same errors as numbered by the design sketch that preceded SEP-3415, which ChatGPT implements. */
export const EVENTS_SKETCH_ERROR_CODES = {
  notFound: -32011,
  forbidden: -32012,
  resourceExhausted: -32013,
  unsupported: -32014,
  callbackEndpointError: -32015,
} as const;

export type EventsErrorName = keyof typeof EVENTS_ERROR_CODES;

/** Header of every webhook delivery: the subscription's server-derived id. */
export const MCP_SUBSCRIPTION_ID_HEADER = 'X-MCP-Subscription-Id' as const;

/** Where a webhook receiver publishes the path prefixes that accept MCP deliveries. */
export const MCP_WEBHOOK_RECEIVER_WELL_KNOWN_PATH = '/.well-known/mcp-webhook-receiver.json' as const;

/** The settings object of the extension in server capabilities. */
export interface EventsExtensionSettings {
  listChanged?: boolean;
}

export const EVENT_DELIVERY_MODES = ['poll', 'push', 'webhook'] as const;
export const EventDeliveryModeSchema = z.enum(EVENT_DELIVERY_MODES);
export type EventDeliveryMode = z.infer<typeof EventDeliveryModeSchema>;

export const EVENT_DELIVERY_ERROR_CATEGORIES = [
  'connection_refused',
  'timeout',
  'tls_error',
  'http_4xx',
  'http_5xx',
  'challenge_failed',
] as const;
export const EventDeliveryErrorCategorySchema = z.enum(EVENT_DELIVERY_ERROR_CATEGORIES);
export type EventDeliveryErrorCategory = z.infer<typeof EventDeliveryErrorCategorySchema>;

const metaSchema = z.record(z.string(), z.unknown()).optional();
const jsonObjectSchema = z.record(z.string(), z.unknown());
const maxAgeMsSchema = z.number().int().nonnegative().optional();

/** A subscription position: optional and nullable wherever it appears, and absent means `null`. */
const cursorSchema = z.string().nullable().optional();

/** `resultType` is added to every result under protocol 2026-07-28 and absent under earlier revisions. */
const resultShape = {
  _meta: metaSchema,
  resultType: z.string().optional(),
};

const subscriptionShape = {
  name: z.string(),
  arguments: jsonObjectSchema.optional(),
};

export const EventErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: jsonObjectSchema.optional(),
});
export type EventError = z.infer<typeof EventErrorSchema>;

export const EventDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  delivery: z.array(EventDeliveryModeSchema).min(1),
  inputSchema: jsonObjectSchema,
  payloadSchema: jsonObjectSchema,
  _meta: metaSchema,
});
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;

export const EventOccurrenceSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  timestamp: z.string(),
  data: jsonObjectSchema,
  cursor: cursorSchema,
  _meta: metaSchema,
});
export type EventOccurrence = z.infer<typeof EventOccurrenceSchema>;

export const EventDeliveryStatusSchema = z.object({
  active: z.boolean(),
  lastDeliveryAt: z.string().nullable().optional(),
  lastError: EventDeliveryErrorCategorySchema.nullable().optional(),
  failedSince: z.string().nullable().optional(),
  throttled: z.boolean().optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type EventDeliveryStatus = z.infer<typeof EventDeliveryStatusSchema>;

export const ListEventsRequestSchema = z.object({
  method: z.literal(EVENTS_METHODS.list),
  params: z.object({ cursor: cursorSchema, _meta: metaSchema }).optional(),
});
export type ListEventsRequest = z.infer<typeof ListEventsRequestSchema>;

export const ListEventsResultSchema = z.object({
  ...resultShape,
  events: z.array(EventDefinitionSchema),
  nextCursor: z.string().optional(),
});
export type ListEventsResult = z.infer<typeof ListEventsResultSchema>;

export const SubscribeEventRequestSchema = z.object({
  method: z.literal(EVENTS_METHODS.subscribe),
  params: z.object({
    ...subscriptionShape,
    delivery: z.object({
      mode: EventDeliveryModeSchema.optional(),
      url: z.string(),
      secret: z.string(),
    }),
    cursor: cursorSchema,
    maxAgeMs: maxAgeMsSchema,
    ttlMs: z.number().int().nullable().optional(),
    _meta: metaSchema,
  }),
});
export type SubscribeEventRequest = z.infer<typeof SubscribeEventRequestSchema>;

export const SubscribeEventResultSchema = z.object({
  ...resultShape,
  id: z.string(),
  refreshBefore: z.string().nullable(),
  cursor: cursorSchema,
  truncated: z.boolean().optional(),
  deliveryStatus: EventDeliveryStatusSchema.optional(),
});
export type SubscribeEventResult = z.infer<typeof SubscribeEventResultSchema>;

export const UnsubscribeEventRequestSchema = z.object({
  method: z.literal(EVENTS_METHODS.unsubscribe),
  params: z.object({
    ...subscriptionShape,
    delivery: z.object({
      mode: EventDeliveryModeSchema.optional(),
      url: z.string(),
    }),
    _meta: metaSchema,
  }),
});
export type UnsubscribeEventRequest = z.infer<typeof UnsubscribeEventRequestSchema>;

export const UnsubscribeEventResultSchema = z.object(resultShape);
export type UnsubscribeEventResult = z.infer<typeof UnsubscribeEventResultSchema>;

export const PollEventsRequestSchema = z.object({
  method: z.literal(EVENTS_METHODS.poll),
  params: z.object({
    ...subscriptionShape,
    cursor: cursorSchema,
    maxAgeMs: maxAgeMsSchema,
    maxEvents: z.number().int().positive().optional(),
    _meta: metaSchema,
  }),
});
export type PollEventsRequest = z.infer<typeof PollEventsRequestSchema>;

export const PollEventsResultSchema = z.object({
  ...resultShape,
  events: z.array(EventOccurrenceSchema),
  cursor: cursorSchema,
  truncated: z.boolean().optional(),
  hasMore: z.boolean().optional(),
  nextPollMs: z.number().int().nonnegative().optional(),
});
export type PollEventsResult = z.infer<typeof PollEventsResultSchema>;

export const StreamEventsRequestSchema = z.object({
  method: z.literal(EVENTS_METHODS.stream),
  params: z.object({
    ...subscriptionShape,
    cursor: cursorSchema,
    maxAgeMs: maxAgeMsSchema,
    _meta: metaSchema,
  }),
});
export type StreamEventsRequest = z.infer<typeof StreamEventsRequestSchema>;

export const StreamEventsResultSchema = z.object(resultShape);
export type StreamEventsResult = z.infer<typeof StreamEventsResultSchema>;

export const EventsListChangedNotificationSchema = z.object({
  method: z.literal(EVENTS_NOTIFICATIONS.listChanged),
  params: z.object({ _meta: metaSchema }).optional(),
});
export type EventsListChangedNotification = z.infer<typeof EventsListChangedNotificationSchema>;

export const EventActiveNotificationSchema = z.object({
  method: z.literal(EVENTS_NOTIFICATIONS.active),
  params: z.object({ cursor: cursorSchema, truncated: z.boolean().optional(), _meta: metaSchema }),
});
export type EventActiveNotification = z.infer<typeof EventActiveNotificationSchema>;

export const EventOccurrenceNotificationSchema = z.object({
  method: z.literal(EVENTS_NOTIFICATIONS.event),
  params: EventOccurrenceSchema,
});
export type EventOccurrenceNotification = z.infer<typeof EventOccurrenceNotificationSchema>;

export const EventErrorNotificationSchema = z.object({
  method: z.literal(EVENTS_NOTIFICATIONS.error),
  params: z.object({ error: EventErrorSchema, _meta: metaSchema }),
});
export type EventErrorNotification = z.infer<typeof EventErrorNotificationSchema>;

export const EventHeartbeatNotificationSchema = z.object({
  method: z.literal(EVENTS_NOTIFICATIONS.heartbeat),
  params: z.object({ cursor: cursorSchema, _meta: metaSchema }),
});
export type EventHeartbeatNotification = z.infer<typeof EventHeartbeatNotificationSchema>;

export const EventTerminatedNotificationSchema = z.object({
  method: z.literal(EVENTS_NOTIFICATIONS.terminated),
  params: z.object({ error: EventErrorSchema, _meta: metaSchema }),
});
export type EventTerminatedNotification = z.infer<typeof EventTerminatedNotificationSchema>;

export const EventVerificationEnvelopeSchema = z.object({
  type: z.literal('verification'),
  challenge: z.string(),
});
export type EventVerificationEnvelope = z.infer<typeof EventVerificationEnvelopeSchema>;

export const EventGapEnvelopeSchema = z.object({
  type: z.literal('gap'),
  cursor: cursorSchema,
});
export type EventGapEnvelope = z.infer<typeof EventGapEnvelopeSchema>;

export const EventTerminatedEnvelopeSchema = z.object({
  type: z.literal('terminated'),
  error: EventErrorSchema,
});
export type EventTerminatedEnvelope = z.infer<typeof EventTerminatedEnvelopeSchema>;

/** A webhook body with a top-level `type`; a body without one is an `EventOccurrence`. */
export const EventControlEnvelopeSchema = z.discriminatedUnion('type', [
  EventVerificationEnvelopeSchema,
  EventGapEnvelopeSchema,
  EventTerminatedEnvelopeSchema,
]);
export type EventControlEnvelope = z.infer<typeof EventControlEnvelopeSchema>;
