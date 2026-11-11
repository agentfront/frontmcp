import type { AuthoritiesMetadata } from '@frontmcp/auth';
import { internalZ as z } from '@frontmcp/lazy-zod';
import { EVENT_DELIVERY_MODES, type EventDeliveryMode } from '@frontmcp/protocol';
import { entryAvailabilitySchema, type EntryAvailability } from '@frontmcp/utils';

import { type RawZodShape } from '../types';
import { redisOptionsSchema, type RedisOptionsInput } from '../types/options/redis';
import { sqliteOptionsSchema, type SqliteOptionsInput } from '../types/options/sqlite';

declare global {
  /** Declarative metadata extends for the Event decorator. */
  interface ExtendFrontMcpEventMetadata {}
}

/** A zod raw shape or `z.object()`: subscription arguments and event payloads are objects. */
export type EventSchemaType = z.ZodRawShape | z.ZodObject;

export const EVENT_NAME_MAX_LENGTH = 128;

export interface EventTtlOptions {
  /** Lifetime granted to a subscription that suggests none. */
  defaultMs?: number;
  /** Longest lifetime granted to a subscription. */
  maxMs?: number;
}

/** Declarative metadata describing an event type clients can subscribe to. */
export interface EventMetadata<
  InSchema extends EventSchemaType = EventSchemaType,
  PayloadSchema extends EventSchemaType = EventSchemaType,
> extends ExtendFrontMcpEventMetadata {
  /** Unique in the server; at most 128 characters, without whitespace or control characters. */
  name: string;

  description?: string;

  /** The arguments of a subscription. Without it, a subscription takes none. */
  inputSchema?: InSchema;

  /** The `data` of each occurrence. */
  payloadSchema: PayloadSchema;

  /** Restricts the delivery modes of this event. By default it offers every mode the server can perform. */
  delivery?: EventDeliveryMode[];

  tags?: string[];

  /** Leaves the event out of `events/list`; a client that knows its name can still subscribe. */
  hideFromDiscovery?: boolean;

  availableWhen?: EntryAvailability;

  /** Subscription lifetime bounds for this event, within the server's. */
  ttl?: EventTtlOptions;
}

const eventNameSchema = z
  .string()
  .min(1, 'An event name must not be empty')
  .max(EVENT_NAME_MAX_LENGTH, `An event name must be at most ${EVENT_NAME_MAX_LENGTH} characters`)
  .regex(/^[^\s\p{Cc}]+$/u, 'An event name must not contain whitespace or control characters');

/** Whether a schema was given as a `z.object()`. */
function isZodObject(value: unknown): boolean {
  const schema = value as { type?: unknown; safeParse?: unknown } | null;
  return typeof schema?.safeParse === 'function' && schema.type === 'object';
}

/** Whether a schema was given as a raw shape of zod fields. */
function isZodRawShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (field) => typeof (field as { safeParse?: unknown } | null)?.safeParse === 'function',
  );
}

const eventSchemaTypeSchema = z.custom<EventSchemaType>((value) => isZodObject(value) || isZodRawShape(value), {
  message: 'Expected a zod raw shape or z.object()',
});

const eventTtlSchema = z
  .object({
    defaultMs: z.number().int().positive().optional(),
    maxMs: z.number().int().positive().optional(),
  })
  .refine((ttl) => ttl.defaultMs === undefined || ttl.maxMs === undefined || ttl.defaultMs <= ttl.maxMs, {
    message: 'ttl.defaultMs must not exceed ttl.maxMs',
  });

export const frontMcpEventMetadataSchema = z
  .object({
    name: eventNameSchema,
    description: z.string().optional(),
    inputSchema: eventSchemaTypeSchema.optional(),
    payloadSchema: eventSchemaTypeSchema,
    delivery: z.array(z.enum(EVENT_DELIVERY_MODES)).min(1, 'delivery must name at least one mode').optional(),
    tags: z.array(z.string().min(1)).optional(),
    hideFromDiscovery: z.boolean().optional().default(false),
    availableWhen: entryAvailabilitySchema.optional(),
    ttl: eventTtlSchema.optional(),
  } satisfies RawZodShape<EventMetadata, ExtendFrontMcpEventMetadata>)
  .passthrough();

/** Which dialect of the events protocol a caller is answered in. */
export type EventsCompat = 'auto' | 'sep-3415' | 'sketch';

/** Where subscriptions are kept. Without `redis` or `sqlite` they live in memory and end with the process. */
export interface EventsStoreOptions {
  redis?: RedisOptionsInput;
  sqlite?: SqliteOptionsInput & { path: string };
  /** @default 'mcp:events:' */
  keyPrefix?: string;
}

export interface EventSubscriptionsOptions {
  /** The lifetime of a subscription that asks for none. @default 3_600_000 (1 hour) */
  defaultTtlMs?: number;
  /** The longest lifetime granted. @default 86_400_000 (24 hours) */
  maxTtlMs?: number;
  /** The shortest lifetime granted, whatever a subscription asks for. @default 60_000 (1 minute) */
  minTtlMs?: number;
  /** Grant `ttlMs: null`, a subscription that never expires. Needs `events.store`. @default false */
  allowNoExpiry?: boolean;
  /** How many subscriptions one caller may hold. @default 100 */
  maxPerPrincipal?: number;
  /** How often a publish checks a subscription's owner against the event's `authorities` again. @default 300_000 */
  reauthorizeEveryMs?: number;
  /** How long a suspended subscription without expiry is kept before it is ended. @default 604_800_000 (7 days) */
  suspendedTtlMs?: number;
}

export interface EventsWebhookVerificationOptions {
  /** How long a callback a caller proved stays verified for that caller. @default 3_600_000 (1 hour) */
  cacheTtlMs?: number;
  /** How long the callback has to answer the verification request. @default 10_000 */
  timeoutMs?: number;
}

export interface EventsWebhookDeliveryOptions {
  /** How long a callback has to answer one delivery. @default 10_000 */
  timeoutMs?: number;
  /** How many times one delivery is attempted. @default 5 */
  maxAttempts?: number;
  /** How long after its first attempt a delivery is still retried. @default 900_000 (15 minutes) */
  retryWindowMs?: number;
  /** The wait before the second attempt; it doubles with each attempt. @default 1_000 */
  backoffMs?: number;
  /** The longest wait between two attempts. @default 60_000 */
  maxBackoffMs?: number;
  /** How many deliveries are in flight at once in one process. @default 16 */
  concurrency?: number;
}

export interface EventsWebhookOptions {
  /** `false` turns webhook delivery off. @default true */
  enabled?: boolean;
  /** Callback URL prefixes accepted without a verification request, such as `https://hooks.example.com/mcp/`. */
  allowedCallbacks?: string[];
  /** Test-only: also accept `http:` callbacks and loopback or private addresses. @default false */
  unsafeAllowLocalCallbacks?: boolean;
  verification?: EventsWebhookVerificationOptions;
  delivery?: EventsWebhookDeliveryOptions;
  /** How long deliveries stay signed with the secret a refresh replaced. @default 300_000 (5 minutes) */
  rotationGraceMs?: number;
}

/** The shortest `events.publishEndpoint.secret` accepted. */
const EVENT_PUBLISH_SECRET_MIN_LENGTH = 32;

/** The HTTP endpoint another service publishes events on, one event per `POST`. */
export interface EventsPublishEndpointOptions {
  /** Serve the endpoint. @default false */
  enabled?: boolean;
  /** Where it is served, under the scope's route base. @default '/events/publish' */
  path?: string;
  /**
   * The shared secret callers sign each request with, as the callers of a workflow webhook do; at least 32
   * characters. Without it, a caller presents the bearer credentials of the MCP endpoint.
   */
  secret?: string;
  /** The rule a bearer caller must satisfy, with the request body as its input. Not taken together with `secret`. */
  authorities?: AuthoritiesMetadata;
}

/** The recent occurrences kept in memory for `events/poll`, per event. */
export interface EventsBufferOptions {
  /** How long a published occurrence can still be polled. @default 600_000 (10 minutes) */
  maxAgeMs?: number;
  /** How many occurrences are kept for one event. @default 10_000 */
  maxEvents?: number;
}

export interface EventsPollOptions {
  /** `false` turns `events/poll` off. @default true */
  enabled?: boolean;
  /** The wait between two polls the server recommends. @default 30_000 */
  nextPollMs?: number;
  /** The most occurrences one poll returns, and the cap of a request's `maxEvents`. @default 100 */
  maxEvents?: number;
}

/** Server-level events configuration (`@FrontMcp({ events })`). */
export interface EventsConfigOptions {
  /** `false` turns events off although apps declare them. They are on whenever an app declares one. */
  enabled?: boolean;
  /** Default `'auto'`: a caller detected as OpenAI gets the design-sketch dialect, every other caller SEP-3415. */
  compat?: EventsCompat;
  store?: EventsStoreOptions;
  subscriptions?: EventSubscriptionsOptions;
  webhook?: EventsWebhookOptions;
  publishEndpoint?: EventsPublishEndpointOptions;
  buffer?: EventsBufferOptions;
  poll?: EventsPollOptions;
}

const positiveIntegerSchema = z.number().int().positive();

const eventsStoreSchema = z
  .object({
    redis: redisOptionsSchema.optional(),
    sqlite: sqliteOptionsSchema.extend({ path: z.string().min(1) }).optional(),
    keyPrefix: z.string().min(1).optional(),
  })
  .refine((store) => !(store.redis && store.sqlite), { message: 'events.store takes redis or sqlite, not both' });

const eventSubscriptionsSchema = z
  .object({
    defaultTtlMs: positiveIntegerSchema.optional().default(3_600_000),
    maxTtlMs: positiveIntegerSchema.optional().default(86_400_000),
    minTtlMs: positiveIntegerSchema.optional().default(60_000),
    allowNoExpiry: z.boolean().optional().default(false),
    maxPerPrincipal: positiveIntegerSchema.optional().default(100),
    reauthorizeEveryMs: positiveIntegerSchema.optional().default(300_000),
    suspendedTtlMs: positiveIntegerSchema.optional().default(604_800_000),
  } satisfies RawZodShape<EventSubscriptionsOptions>)
  .refine((ttl) => ttl.minTtlMs <= ttl.defaultTtlMs && ttl.defaultTtlMs <= ttl.maxTtlMs, {
    message: 'events.subscriptions needs minTtlMs <= defaultTtlMs <= maxTtlMs; set the three together',
  });

const eventsWebhookVerificationSchema = z.object({
  cacheTtlMs: positiveIntegerSchema.optional().default(3_600_000),
  timeoutMs: positiveIntegerSchema.optional().default(10_000),
} satisfies RawZodShape<EventsWebhookVerificationOptions>);

const eventsWebhookDeliverySchema = z
  .object({
    timeoutMs: positiveIntegerSchema.optional().default(10_000),
    maxAttempts: positiveIntegerSchema.optional().default(5),
    retryWindowMs: positiveIntegerSchema.optional().default(900_000),
    backoffMs: positiveIntegerSchema.optional().default(1_000),
    maxBackoffMs: positiveIntegerSchema.optional().default(60_000),
    concurrency: positiveIntegerSchema.optional().default(16),
  } satisfies RawZodShape<EventsWebhookDeliveryOptions>)
  .refine((delivery) => delivery.backoffMs <= delivery.maxBackoffMs, {
    message: 'events.webhook.delivery needs backoffMs <= maxBackoffMs',
  });

const eventsWebhookSchema = z.object({
  enabled: z.boolean().optional().default(true),
  allowedCallbacks: z.array(z.string().url()).optional().default([]),
  unsafeAllowLocalCallbacks: z.boolean().optional().default(false),
  verification: eventsWebhookVerificationSchema
    .optional()
    .transform((verification) => verification ?? eventsWebhookVerificationSchema.parse({})),
  delivery: eventsWebhookDeliverySchema
    .optional()
    .transform((delivery) => delivery ?? eventsWebhookDeliverySchema.parse({})),
  rotationGraceMs: positiveIntegerSchema.optional().default(300_000),
} satisfies RawZodShape<EventsWebhookOptions>);

/** Literal segments only: the endpoint is one path, without parameters, a query or a fragment. */
const PUBLISH_ENDPOINT_PATH = /^\/[^?#\s*(){}:]*$/;

const eventsPublishEndpointSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    path: z
      .string()
      .regex(PUBLISH_ENDPOINT_PATH, 'events.publishEndpoint.path must start with "/" and hold literal segments only')
      .optional()
      .default('/events/publish'),
    secret: z
      .string()
      .min(
        EVENT_PUBLISH_SECRET_MIN_LENGTH,
        `events.publishEndpoint.secret must be at least ${EVENT_PUBLISH_SECRET_MIN_LENGTH} characters ` +
          '(make one with: openssl rand -hex 32)',
      )
      .optional(),
    authorities: z
      .custom<AuthoritiesMetadata>((rule) => typeof rule === 'string' || (typeof rule === 'object' && rule !== null), {
        message: 'events.publishEndpoint.authorities must be a profile name, a list of names or a policy',
      })
      .optional(),
  } satisfies RawZodShape<EventsPublishEndpointOptions>)
  .refine((endpoint) => endpoint.secret === undefined || endpoint.authorities === undefined, {
    message:
      'events.publishEndpoint takes secret or authorities, not both: a signed request names no caller for a rule ' +
      'to check',
  });

const eventsBufferSchema = z.object({
  maxAgeMs: positiveIntegerSchema.optional().default(600_000),
  maxEvents: positiveIntegerSchema.optional().default(10_000),
} satisfies RawZodShape<EventsBufferOptions>);

const eventsPollSchema = z.object({
  enabled: z.boolean().optional().default(true),
  nextPollMs: positiveIntegerSchema.optional().default(30_000),
  maxEvents: positiveIntegerSchema.optional().default(100),
} satisfies RawZodShape<EventsPollOptions>);

export const eventsConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    compat: z.enum(['auto', 'sep-3415', 'sketch']).optional().default('auto'),
    store: eventsStoreSchema.optional(),
    subscriptions: eventSubscriptionsSchema
      .optional()
      .transform((subscriptions) => subscriptions ?? eventSubscriptionsSchema.parse({})),
    webhook: eventsWebhookSchema.optional().transform((webhook) => webhook ?? eventsWebhookSchema.parse({})),
    publishEndpoint: eventsPublishEndpointSchema
      .optional()
      .transform((publishEndpoint) => publishEndpoint ?? eventsPublishEndpointSchema.parse({})),
    buffer: eventsBufferSchema.optional().transform((buffer) => buffer ?? eventsBufferSchema.parse({})),
    poll: eventsPollSchema.optional().transform((poll) => poll ?? eventsPollSchema.parse({})),
  } satisfies RawZodShape<EventsConfigOptions>)
  .refine((config) => !config.subscriptions.allowNoExpiry || Boolean(config.store?.redis ?? config.store?.sqlite), {
    message: 'events.subscriptions.allowNoExpiry needs events.store.redis or events.store.sqlite',
  });

/** The events configuration with its defaults applied. */
export type EventsConfig = z.infer<typeof eventsConfigSchema>;
