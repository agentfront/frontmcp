import { type Type } from '@frontmcp/di';

import { type EventContext, type EventFunction } from '../interfaces';
import { type EventMetadata } from '../metadata';

export enum EventKind {
  /** A class decorated with `@Event` */
  CLASS_TOKEN = 'CLASS_TOKEN',
  /** What `event()` returns */
  FUNCTION = 'FUNCTION',
}

export interface EventClassTokenRecord {
  kind: EventKind.CLASS_TOKEN;
  provide: Type<EventContext>;
  metadata: EventMetadata;
}

export interface EventFunctionTokenRecord {
  kind: EventKind.FUNCTION;
  provide: EventFunction;
  metadata: EventMetadata;
}

export type EventRecord = EventClassTokenRecord | EventFunctionTokenRecord;
