import 'reflect-metadata';

import type z from '@frontmcp/lazy-zod';

import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { type EventContext, type EventFunction, type EventHandlers, type EventTyping } from '../interfaces';
import { frontMcpEventMetadataSchema, type EventMetadata, type EventSchemaType } from '../metadata';
import { FrontMcpEventTokens } from '../tokens';

const FUNCTION_EVENT = 'function-event';

/** Validates what `@Event` or `event()` was given and returns the metadata with its defaults. */
function parseEventMetadata(providedMetadata: unknown): EventMetadata {
  const result = frontMcpEventMetadataSchema.safeParse(providedMetadata);
  if (result.success) return result.data as EventMetadata;
  const [issue] = result.error.issues;
  throw new InvalidDecoratorMetadataError('Event', issue.path.join('.'), issue.message);
}

/** The class decorator that records the validated metadata on an `@Event` class. */
function defineEvent(providedMetadata: EventMetadata): ClassDecorator {
  return (target) => {
    const metadata = parseEventMetadata(providedMetadata);
    Reflect.defineMetadata(FrontMcpEventTokens.type, true, target);
    Reflect.defineMetadata(FrontMcpEventTokens.metadata, metadata, target);
  };
}

type SchemaObject<Schema> = Schema extends z.ZodObject
  ? z.output<Schema>
  : Schema extends z.ZodRawShape
    ? z.output<z.ZodObject<Schema>>
    : never;

type InputOfSchema<Schema> = [Schema] extends [never] ? Record<string, never> : SchemaObject<Schema>;

type EventClass = abstract new (...args: never[]) => unknown;

/** The subscription arguments of an event: of its `@Event` class, its `event()` function, or its options. */
export type EventInputOf<T> = T extends { payloadSchema: unknown }
  ? T extends { inputSchema: infer Schema }
    ? SchemaObject<Schema>
    : Record<string, never>
  : T extends abstract new (...args: never[]) => EventTyping<infer In, unknown>
    ? In
    : T extends EventTyping<infer In, unknown>
      ? In
      : never;

/** The `data` of an event's occurrences: of its `@Event` class, its `event()` function, or its options. */
export type EventPayloadOf<T> = T extends { payloadSchema: infer Schema }
  ? SchemaObject<Schema>
  : T extends abstract new (...args: never[]) => EventTyping<unknown, infer Payload>
    ? Payload
    : T extends EventTyping<unknown, infer Payload>
      ? Payload
      : never;

type MustExtendEventContext<C extends EventClass> = C extends abstract new (
  ...args: never[]
) => EventContext<unknown, unknown>
  ? unknown
  : { 'Event class error': 'Class must extend EventContext' };

type TypeMismatch<Subject extends string, Expected, Declared> = {
  'Event class error': `EventContext declares another ${Subject} type than the schema`;
  expected: Expected;
  declared: Declared;
};

/** A class that leaves an EventContext type at its default is not checked against the schema. */
type MustDeclare<Subject extends string, Expected, Declared> =
  Record<string, unknown> extends Declared
    ? unknown
    : [Declared] extends [Expected]
      ? [Expected] extends [Declared]
        ? unknown
        : TypeMismatch<Subject, Expected, Declared>
      : TypeMismatch<Subject, Expected, Declared>;

type EventDecorator = <
  InSchema extends EventSchemaType = never,
  PayloadSchema extends EventSchemaType = EventSchemaType,
>(
  metadata: EventMetadata<InSchema, PayloadSchema>,
) => <C extends EventClass>(
  target: C &
    MustExtendEventContext<C> &
    MustDeclare<'arguments', InputOfSchema<InSchema>, EventInputOf<C>> &
    MustDeclare<'payload', SchemaObject<PayloadSchema>, EventPayloadOf<C>>,
) => void;

type EventOptions<InSchema extends EventSchemaType, PayloadSchema extends EventSchemaType> = EventMetadata<
  InSchema,
  PayloadSchema
> &
  EventHandlers<InputOfSchema<InSchema>, SchemaObject<PayloadSchema>> &
  ThisType<EventContext<InputOfSchema<InSchema>, SchemaObject<PayloadSchema>>>;

/** Function builder for events: the metadata of `@Event`, with the optional methods of `EventContext` beside it. */
function frontMcpEvent<
  InSchema extends EventSchemaType = never,
  PayloadSchema extends EventSchemaType = EventSchemaType,
>(options: EventOptions<InSchema, PayloadSchema>): EventFunction<InputOfSchema<InSchema>, SchemaObject<PayloadSchema>> {
  const { authorize, match, transform, check, onSubscribe, onUnsubscribe, ...providedMetadata } = options;
  const metadata = parseEventMetadata(providedMetadata);
  const handlers = { authorize, match, transform, check, onSubscribe, onUnsubscribe };
  const eventFunction = () => handlers;
  Object.assign(eventFunction, {
    [FrontMcpEventTokens.type]: FUNCTION_EVENT,
    [FrontMcpEventTokens.metadata]: metadata,
  });
  return eventFunction as EventFunction<InputOfSchema<InSchema>, SchemaObject<PayloadSchema>>;
}

/** Whether a value is a class decorated with `@Event`. */
export function isEventClass(target: unknown): boolean {
  return typeof target === 'function' && Reflect.getMetadata(FrontMcpEventTokens.type, target) === true;
}

/** Whether a value is what `event()` returned. */
export function isEventFunction(target: unknown): boolean {
  if (typeof target !== 'function') return false;
  return (target as unknown as Record<symbol, unknown>)[FrontMcpEventTokens.type] === FUNCTION_EVENT;
}

/** Marks a class that extends `EventContext` as an event clients can list and subscribe to. */
const FrontMcpEvent = defineEvent as unknown as EventDecorator;
const Event = FrontMcpEvent;

export { FrontMcpEvent, Event, frontMcpEvent, frontMcpEvent as event };
