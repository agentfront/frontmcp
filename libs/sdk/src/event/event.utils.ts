import 'reflect-metadata';

import { type Type } from '@frontmcp/di';

import { isEventClass, isEventFunction } from '../common/decorators/event.decorator';
import { type EventContext, type EventFunction, type EventType } from '../common/interfaces/event.interface';
import { type EventMetadata } from '../common/metadata/event.metadata';
import { EventKind, type EventRecord } from '../common/records';
import { FrontMcpEventTokens } from '../common/tokens/event.tokens';
import { InvalidEntityError } from '../errors';

/** Whether a listed item is already a record, as a registry adopting another registry's events passes. */
function isEventRecord(item: unknown): item is EventRecord {
  return typeof item === 'object' && item !== null && 'kind' in item && 'provide' in item && 'metadata' in item;
}

/** The record of an `@Event` class or an `event()` function, which the registry builds its instance from. */
export function normalizeEvent(item: EventType | EventRecord): EventRecord {
  if (isEventRecord(item)) return item;

  if (isEventClass(item)) {
    return {
      kind: EventKind.CLASS_TOKEN,
      provide: item as Type<EventContext>,
      metadata: Reflect.getMetadata(FrontMcpEventTokens.metadata, item) as EventMetadata,
    };
  }

  if (isEventFunction(item)) {
    return {
      kind: EventKind.FUNCTION,
      provide: item as EventFunction,
      metadata: (item as unknown as Record<symbol, EventMetadata>)[FrontMcpEventTokens.metadata],
    };
  }

  const name = typeof item === 'function' && item.name ? item.name : String(item);
  throw new InvalidEntityError('event', name, 'a class decorated with @Event() or what event() returns');
}
