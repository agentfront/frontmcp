import { isPublicMode } from '@frontmcp/auth';
import { internalZ as z } from '@frontmcp/lazy-zod';
import type { AuthInfo, EventDeliveryMode } from '@frontmcp/protocol';
import { canonicalJson, sha256Hex } from '@frontmcp/utils';

import {
  type EventContext,
  type EventEntry,
  type EventSubscriber,
  type EventSubscriptionRef,
  type ScopeEntry,
} from '../common';
import { callSurfaceOf, isOfferedOnSurface } from '../common/availability';
import {
  EventForbiddenError,
  EventNotFoundError,
  EventProtocolError,
  EventUnsupportedError,
  InvalidInputError,
  isPublicError,
  type EventErrorCodes,
} from '../errors';
import { eventSubscriberOf } from './event-subscriber';
import type EventRegistry from './event.registry';

/** Who polls or streams an event: a signed-in caller, or the anonymous callers of a public server together. */
export interface EventReader {
  /** The owner's key; undefined for anonymous callers, who share one subscription per event and arguments. */
  principalKey: string | undefined;
  subscriber: EventSubscriber;
}

const ANONYMOUS_SUBSCRIBER: EventSubscriber = { sub: '', roles: [], permissions: [], scopes: [], claims: {} };

/** The event a request names, when the caller's surface is offered it in `mode`. */
export function offeredEventOf(
  events: EventRegistry,
  eventName: string,
  mode: EventDeliveryMode,
  requestContext: unknown,
  codes: EventErrorCodes,
): EventEntry {
  const event = events.findByName(eventName);
  if (!event || !isOfferedOnSurface(event.metadata.availableWhen, callSurfaceOf(requestContext))) {
    throw new EventNotFoundError(codes, 'event', eventName);
  }
  const offeredModes = events.deliveryModesOf(event);
  if (!offeredModes.includes(mode)) throw new EventUnsupportedError(codes, 'deliveryMode', mode, offeredModes);
  return event;
}

/** The reader of a poll or a stream: anonymous callers are readers on a server in public auth mode only. */
export function eventReaderOf(
  scope: ScopeEntry,
  authInfo: Partial<AuthInfo>,
  eventName: string,
  codes: EventErrorCodes,
): EventReader {
  const owner = eventSubscriberOf(authInfo, scope.authoritiesContextBuilder);
  if (owner) return owner;
  const authOptions = scope.auth?.options;
  if (authOptions !== undefined && !isPublicMode(authOptions)) {
    throw new EventForbiddenError(codes, eventName, 'this server needs a signed-in caller');
  }
  return { principalKey: undefined, subscriber: ANONYMOUS_SUBSCRIBER };
}

/** Refuse a caller the event's `authorities` do not allow, with the arguments as the rule's input. */
export async function assertEventAuthorities(
  scope: ScopeEntry,
  event: EventEntry,
  authInfo: Partial<AuthInfo>,
  args: Record<string, unknown>,
  codes: EventErrorCodes,
): Promise<void> {
  const engine = scope.authoritiesEngine;
  const contextBuilder = scope.authoritiesContextBuilder;
  const authorities = event.getAuthorities();
  if (!engine || !contextBuilder || !authorities) return;
  const result = await engine.evaluate(authorities, contextBuilder.build(authInfo as never, args));
  if (!result.granted) throw new EventForbiddenError(codes, event.name, result.deniedBy ?? 'policy denied');
}

/** The arguments of a request as the event's `inputSchema` parses them. */
export function parsedEventArguments(
  event: EventEntry,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  try {
    return event.parseArguments(args ?? {});
  } catch (error) {
    throw new InvalidInputError(
      'Invalid subscription arguments',
      error instanceof z.ZodError ? error.issues : undefined,
    );
  }
}

/** Run the event's own `authorize()`: whatever it throws refuses the reader. */
export async function assertEventAuthorizes(
  context: EventContext,
  eventName: string,
  args: Record<string, unknown>,
  subscriber: EventSubscriber,
  codes: EventErrorCodes,
): Promise<void> {
  try {
    await context.authorize?.(args, subscriber);
  } catch (error) {
    if (error instanceof EventProtocolError) throw error;
    const reason = isPublicError(error) ? error.getPublicMessage() : 'the event refused it';
    throw new EventForbiddenError(codes, eventName, reason);
  }
}

/** The subscription a poll or a stream stands for: one per reader, mode, event and arguments. */
export function readerSubscriptionOf(
  reader: EventReader,
  mode: 'poll' | 'push',
  eventName: string,
  args: Record<string, unknown>,
): EventSubscriptionRef {
  const key = canonicalJson({ principalKey: reader.principalKey ?? null, mode, name: eventName, arguments: args });
  return { id: `sub_${sha256Hex(key).slice(0, 32)}`, name: eventName, mode, subscriber: reader.subscriber };
}
