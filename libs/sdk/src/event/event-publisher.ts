import { base64urlEncode, randomBytes } from '@frontmcp/utils';

import {
  type EventPublisher,
  type EventPublishOptions,
  type EventPublishResult,
  type EventReference,
  type EventType,
  type ScopeEntry,
} from '../common';
import { EventNotRegisteredError, InvalidEventPublishError } from '../errors';
import type EventRegistry from './event.registry';
import { normalizeEvent } from './event.utils';

const EVENT_ID_RANDOM_BYTES = 18;

/** A new event id: `evt_` and 24 random URL-safe characters. */
export function newEventId(): string {
  return `evt_${base64urlEncode(randomBytes(EVENT_ID_RANDOM_BYTES))}`;
}

/** The name of an event given by name, by its `@Event` class or by what `event()` returned. */
function eventNameOf(event: string | EventReference<unknown>): string {
  return typeof event === 'string' ? event : normalizeEvent(event as EventType).metadata.name;
}

/** The timestamp of an occurrence as ISO 8601 in UTC; now when none is given. */
function timestampOf(eventName: string, timestamp: string | Date | undefined): string {
  const time = timestamp === undefined ? new Date() : new Date(timestamp);
  if (Number.isNaN(time.getTime())) {
    throw new InvalidEventPublishError(eventName, `"${String(timestamp)}" is not a timestamp`);
  }
  return time.toISOString();
}

/** Publishes the events of one scope through its `events:publish` flow. */
export class ScopeEventPublisher implements EventPublisher {
  /** Takes the scope whose flow publishes and the registry its events are found in. */
  constructor(
    private readonly scope: ScopeEntry,
    private readonly events: EventRegistry,
  ) {}

  /** Check the event and its data, give the occurrence an id and a time, and queue its deliveries. */
  async publish(
    event: string | EventReference<unknown>,
    data: unknown,
    options: EventPublishOptions = {},
  ): Promise<EventPublishResult> {
    const eventName = eventNameOf(event);
    const entry = this.events.findByName(eventName);
    if (!entry) throw new EventNotRegisteredError(eventName);

    let payload: Record<string, unknown>;
    try {
      payload = entry.parsePayload(data);
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      throw new InvalidEventPublishError(eventName, `its data does not match payloadSchema: ${problem}`);
    }

    const occurrence = {
      eventId: options.eventId ?? newEventId(),
      name: eventName,
      timestamp: timestampOf(eventName, options.timestamp),
      data: payload,
    };
    return this.scope.runFlowForOutput('events:publish', {
      occurrence,
      subscriptionId: options.subscriptionId,
      audience: options.audience,
    });
  }
}
