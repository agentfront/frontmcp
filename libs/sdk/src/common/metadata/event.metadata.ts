import { internalZ as z } from '@frontmcp/lazy-zod';
import { EVENT_DELIVERY_MODES, type EventDeliveryMode } from '@frontmcp/protocol';
import { entryAvailabilitySchema, type EntryAvailability } from '@frontmcp/utils';

import { type RawZodShape } from '../types';

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

function isZodObject(value: unknown): boolean {
  const schema = value as { type?: unknown; safeParse?: unknown } | null;
  return typeof schema?.safeParse === 'function' && schema.type === 'object';
}

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

/** Server-level events configuration (`@FrontMcp({ events })`). */
export interface EventsConfigOptions {
  /** `false` turns events off although apps declare them. They are on whenever an app declares one. */
  enabled?: boolean;
  /** Default `'auto'`: a caller detected as OpenAI gets the design-sketch dialect, every other caller SEP-3415. */
  compat?: EventsCompat;
}

export const eventsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  compat: z.enum(['auto', 'sep-3415', 'sketch']).optional().default('auto'),
} satisfies RawZodShape<EventsConfigOptions>);

/** The events configuration with its defaults applied. */
export type EventsConfig = z.infer<typeof eventsConfigSchema>;
