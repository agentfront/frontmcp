import type { AIPlatformType } from '@frontmcp/auth';
import { EVENTS_ERROR_CODES, EVENTS_SKETCH_ERROR_CODES, type AuthInfo } from '@frontmcp/protocol';

import { type ScopeEntry } from '../common';
import { type EventsCompat } from '../common/metadata/event.metadata';
import { type EventErrorCodes } from '../errors';

/** The revision of the events protocol a caller speaks: SEP-3415, or the design sketch ChatGPT implements. */
export type EventDialect = 'sep-3415' | 'sketch';

export interface EventDialectRules {
  errorCodes: EventErrorCodes;
  /** The `webhook-id` of an event delivery: the event's id, or an id the server makes for each message. */
  webhookId: 'eventId' | 'message';
  /** Whether `gap` and `terminated` envelopes are sent. The `verification` envelope always is. */
  sendsControlEnvelopes: boolean;
}

export const EVENT_DIALECTS: Readonly<Record<EventDialect, EventDialectRules>> = {
  'sep-3415': { errorCodes: EVENTS_ERROR_CODES, webhookId: 'message', sendsControlEnvelopes: true },
  sketch: { errorCodes: EVENTS_SKETCH_ERROR_CODES, webhookId: 'eventId', sendsControlEnvelopes: false },
};

/** The platform a session id names, when it names a known one. */
function knownPlatform(platform: AIPlatformType | undefined): AIPlatformType | undefined {
  return platform && platform !== 'unknown' ? platform : undefined;
}

/** The caller's detected platform: from its session id, else this request, else its `initialize` client info. */
export function callerPlatformOf(
  scope: ScopeEntry,
  authInfo: Partial<AuthInfo>,
  requestPlatform: AIPlatformType | undefined,
): AIPlatformType {
  const detected = knownPlatform(authInfo.sessionIdPayload?.platformType) ?? knownPlatform(requestPlatform);
  if (detected) return detected;
  return authInfo.sessionId ? scope.notifications.getPlatformType(authInfo.sessionId) : 'unknown';
}

/** The dialect a caller is answered in: `events.compat`, or under `auto` the sketch for OpenAI and SEP-3415 otherwise. */
export function resolveEventDialect(compat: EventsCompat, platform: AIPlatformType): EventDialect {
  if (compat !== 'auto') return compat;
  return platform === 'openai' ? 'sketch' : 'sep-3415';
}
