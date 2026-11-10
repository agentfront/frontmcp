import type { AuthoritiesMetadata } from '@frontmcp/auth';
import { toJSONSchema, internalZ as z } from '@frontmcp/lazy-zod';
import type { AuthInfo } from '@frontmcp/protocol';

import type { EventContext } from '../interfaces';
import type { EventMetadata, EventSchemaType } from '../metadata/event.metadata';
import type { EventRecord } from '../records';
import { BaseEntry, type EntryOwnerRef } from './base.entry';

type JsonSchema = Record<string, unknown>;

function toObjectJsonSchema(schema: EventSchemaType, io: 'input' | 'output'): JsonSchema {
  const isZodSchema = typeof (schema as { safeParse?: unknown }).safeParse === 'function';
  const objectSchema = isZodSchema ? (schema as z.ZodObject) : z.object(schema as z.ZodRawShape);
  return toJSONSchema(objectSchema, { io, unrepresentable: 'any' }) as JsonSchema;
}

/** A registered event. Concrete implementation: `EventInstance`. */
export abstract class EventEntry extends BaseEntry<EventRecord, EventContext, EventMetadata> {
  owner: EntryOwnerRef;
  name: string;
  /** The name with the owner's id as prefix. */
  fullName: string;

  private inputJsonSchema?: JsonSchema;
  private payloadJsonSchema?: JsonSchema;

  getTags(): string[] {
    return this.metadata.tags ?? [];
  }

  /** The rule a caller must satisfy to list the event and to subscribe to it, when it declares one. */
  getAuthorities(): AuthoritiesMetadata | undefined {
    return this.metadata.authorities;
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
