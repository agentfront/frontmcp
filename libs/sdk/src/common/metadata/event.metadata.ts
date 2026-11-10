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
}

export interface EventsWebhookVerificationOptions {
  /** How long a callback a caller proved stays verified for that caller. @default 3_600_000 (1 hour) */
  cacheTtlMs?: number;
  /** How long the callback has to answer the verification request. @default 10_000 */
  timeoutMs?: number;
}

export interface EventsWebhookOptions {
  /** `false` turns webhook delivery off. @default true */
  enabled?: boolean;
  /** Callback URL prefixes accepted without a verification request, such as `https://hooks.example.com/mcp/`. */
  allowedCallbacks?: string[];
  /** Test-only: also accept `http:` callbacks and loopback or private addresses. @default false */
  unsafeAllowLocalCallbacks?: boolean;
  verification?: EventsWebhookVerificationOptions;
  /** How long deliveries stay signed with the secret a refresh replaced. @default 300_000 (5 minutes) */
  rotationGraceMs?: number;
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
  } satisfies RawZodShape<EventSubscriptionsOptions>)
  .refine((ttl) => ttl.minTtlMs <= ttl.defaultTtlMs && ttl.defaultTtlMs <= ttl.maxTtlMs, {
    message: 'events.subscriptions needs minTtlMs <= defaultTtlMs <= maxTtlMs; set the three together',
  });

const eventsWebhookVerificationSchema = z.object({
  cacheTtlMs: positiveIntegerSchema.optional().default(3_600_000),
  timeoutMs: positiveIntegerSchema.optional().default(10_000),
} satisfies RawZodShape<EventsWebhookVerificationOptions>);

const eventsWebhookSchema = z.object({
  enabled: z.boolean().optional().default(true),
  allowedCallbacks: z.array(z.string().url()).optional().default([]),
  unsafeAllowLocalCallbacks: z.boolean().optional().default(false),
  verification: eventsWebhookVerificationSchema
    .optional()
    .transform((verification) => verification ?? eventsWebhookVerificationSchema.parse({})),
  rotationGraceMs: positiveIntegerSchema.optional().default(300_000),
} satisfies RawZodShape<EventsWebhookOptions>);

export const eventsConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    compat: z.enum(['auto', 'sep-3415', 'sketch']).optional().default('auto'),
    store: eventsStoreSchema.optional(),
    subscriptions: eventSubscriptionsSchema
      .optional()
      .transform((subscriptions) => subscriptions ?? eventSubscriptionsSchema.parse({})),
    webhook: eventsWebhookSchema.optional().transform((webhook) => webhook ?? eventsWebhookSchema.parse({})),
  } satisfies RawZodShape<EventsConfigOptions>)
  .refine((config) => !config.subscriptions.allowNoExpiry || Boolean(config.store?.redis ?? config.store?.sqlite), {
    message: 'events.subscriptions.allowNoExpiry needs events.store.redis or events.store.sqlite',
  });

/** The events configuration with its defaults applied. */
export type EventsConfig = z.infer<typeof eventsConfigSchema>;
