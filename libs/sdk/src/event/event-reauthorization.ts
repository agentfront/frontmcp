import { type AuthInfo } from '@frontmcp/protocol';

import { type EventEntry, type EventSubscriber, type ScopeEntry } from '../common';
import { isPublicError } from '../errors';

/** What checking a subscriber again found: still allowed, refused, or not known because the check could not be made. */
export type EventReauthorization =
  | { outcome: 'granted' }
  | { outcome: 'refused'; reason: string }
  | { outcome: 'failed'; error: unknown };

export interface ReauthorizeSubscriberArgs {
  scope: Pick<ScopeEntry, 'authoritiesEngine' | 'authoritiesContextBuilder'>;
  event: EventEntry;
  /** The owner as stored when the subscription was created or last refreshed. */
  subscriber: EventSubscriber;
  /** The subscription's arguments, as its event's input schema parsed them. */
  arguments: Record<string, unknown>;
  /** The auth the event's context is created with. @default the one {@link subscriberAuthInfo} rebuilds */
  authInfo?: Partial<AuthInfo>;
}

/**
 * Whether what an event's `authorize()` threw refuses the subscriber: a public error (an `EventForbiddenError`, any
 * `PublicMcpError`) is the event's answer, as the subscribe flow passes it on. Anything else (an upstream error, a
 * timeout) means the check could not be made.
 */
export function isAuthorizeRefusal(error: unknown): boolean {
  return isPublicError(error);
}

/** The auth of a stored subscriber, for a context its event's methods run on: its claims, subject and scopes, no token. */
export function subscriberAuthInfo(subscriber: EventSubscriber): Partial<AuthInfo> {
  const user = { ...subscriber.claims, sub: subscriber.sub, ...(subscriber.iss && { iss: subscriber.iss }) };
  return { clientId: subscriber.sub, scopes: subscriber.scopes, extra: { user } } as Partial<AuthInfo>;
}

/** Evaluate the event's `authorities` for a stored subscriber, with the subscription's arguments as input. */
async function checkAuthorities(args: ReauthorizeSubscriberArgs): Promise<EventReauthorization> {
  const engine = args.scope.authoritiesEngine;
  const contextBuilder = args.scope.authoritiesContextBuilder;
  const authorities = args.event.getAuthorities();
  if (!engine || !contextBuilder || !authorities) return { outcome: 'granted' };
  const evaluationContext = contextBuilder.build({}, args.arguments);
  const ownerContext = { ...evaluationContext, user: { ...evaluationContext.user, ...args.subscriber } };
  try {
    const result = await engine.evaluate(authorities, ownerContext);
    return result.granted ? { outcome: 'granted' } : { outcome: 'refused', reason: result.deniedBy ?? 'policy denied' };
  } catch (error) {
    return { outcome: 'failed', error };
  }
}

/** Run the event's `authorize()` for a stored subscriber, on a context created for it. */
async function checkAuthorize(args: ReauthorizeSubscriberArgs): Promise<EventReauthorization> {
  const context = args.event.create(args.authInfo ?? subscriberAuthInfo(args.subscriber));
  if (!context.authorize) return { outcome: 'granted' };
  try {
    await context.authorize(args.arguments, args.subscriber);
    return { outcome: 'granted' };
  } catch (error) {
    if (!isAuthorizeRefusal(error)) return { outcome: 'failed', error };
    return { outcome: 'refused', reason: (error as Error).message };
  }
}

/** Check a subscriber of an event again: its `authorities` first, then its `authorize()`; the first that is not granted answers. */
export async function reauthorizeSubscriber(args: ReauthorizeSubscriberArgs): Promise<EventReauthorization> {
  const byAuthorities = await checkAuthorities(args);
  if (byAuthorities.outcome !== 'granted') return byAuthorities;
  return checkAuthorize(args);
}

/** Whether an event has anything to check a subscriber against again. */
export function hasReauthorization(
  scope: ReauthorizeSubscriberArgs['scope'],
  event: EventEntry,
  hasAuthorize: boolean,
) {
  return hasAuthorize || Boolean(scope.authoritiesEngine && scope.authoritiesContextBuilder && event.getAuthorities());
}
