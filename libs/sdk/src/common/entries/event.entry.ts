import type { AuthoritiesMetadata } from '@frontmcp/auth';
import { toJSONSchema, internalZ as z } from '@frontmcp/lazy-zod';
import type { AuthInfo } from '@frontmcp/protocol';

import type { EventContext } from '../interfaces';
import type { EventMetadata, EventSchemaType } from '../metadata/event.metadata';
import type { EventRecord } from '../records';
import { BaseEntry, type EntryOwnerRef } from './base.entry';

type JsonSchema = Record<string, unknown>;

/** The `z.object()` of a schema declared as a raw shape or as an object. */
function toObjectSchema(schema: EventSchemaType): z.ZodObject {
  const isZodSchema = typeof (schema as { safeParse?: unknown }).safeParse === 'function';
  return isZodSchema ? (schema as z.ZodObject) : z.object(schema as z.ZodRawShape);
}

/** The JSON Schema of a zod object or raw shape. */
function toObjectJsonSchema(schema: EventSchemaType, io: 'input' | 'output'): JsonSchema {
  return toJSONSchema(toObjectSchema(schema), { io, unrepresentable: 'any' }) as JsonSchema;
}

/** A registered event. Concrete implementation: `EventInstance`. */
export abstract class EventEntry extends BaseEntry<EventRecord, EventContext, EventMetadata> {
  owner: EntryOwnerRef;
  name: string;
  /** The name with the owner's id as prefix. */
  fullName: string;

  private inputJsonSchema?: JsonSchema;
  private payloadJsonSchema?: JsonSchema;

  /** The event's tags, empty when it declares none. */
  getTags(): string[] {
    return this.metadata.tags ?? [];
  }

  /** The rule a caller must satisfy to list the event and to subscribe to it; `null` and `false` declare none. */
  getAuthorities(): AuthoritiesMetadata | undefined {
    const declared: unknown = this.metadata.authorities;
    const isUnguarded = declared === undefined || declared === null || declared === false;
    return isUnguarded ? undefined : this.metadata.authorities;
  }

  /** The JSON Schema of a subscription's arguments, as `events/list` returns it. */
  getInputJsonSchema(): JsonSchema {
    this.inputJsonSchema ??= this.buildInputJsonSchema();
    return this.inputJsonSchema;
  }

  /** The JSON Schema of an occurrence's `data`, as `events/list` returns it. */
  getPayloadJsonSchema(): JsonSchema {
    this.payloadJsonSchema ??= toObjectJsonSchema(this.metadata.payloadSchema, 'output');
    return this.payloadJsonSchema;
  }

  /** The arguments of a subscription, validated against `inputSchema`; an event without one takes none. */
  parseArguments(args: Record<string, unknown>): Record<string, unknown> {
    const { inputSchema } = this.metadata;
    const schema = inputSchema ? toObjectSchema(inputSchema) : z.object({}).strict();
    return schema.parse(args) as Record<string, unknown>;
  }

  /** The `data` of an occurrence, validated against `payloadSchema`. */
  parsePayload(data: unknown): Record<string, unknown> {
    return toObjectSchema(this.metadata.payloadSchema).parse(data) as Record<string, unknown>;
  }

  /** The declared argument schema, or an empty closed object for an event that takes no arguments. */
  private buildInputJsonSchema(): JsonSchema {
    const { inputSchema } = this.metadata;
    if (!inputSchema) {
      return { type: 'object', properties: {}, additionalProperties: false };
    }
    return toObjectJsonSchema(inputSchema, 'input');
  }

  /** The context the event's `authorize`, `match`, `transform`, `check` and lifecycle methods run on. */
  abstract create(authInfo: Partial<AuthInfo>): EventContext;
}
