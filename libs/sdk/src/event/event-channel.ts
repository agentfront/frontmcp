import { type EventOccurrence } from '@frontmcp/protocol';

import { channelMetaOf } from '../channel/channel.utils';
import { type EventEntry, type ScopeEntry } from '../common';
import { isOfferedOnSurface } from '../common/availability';
import { EventForbiddenError } from '../errors';
import { hasExpiredCaller, type RegisteredServer } from '../notification/notification.service';
import { mcpRequestSurface } from '../transport/mcp-handlers/mcp-surface';
import { EVENT_DIALECTS } from './event-dialect';
import { eventReaderOf, type EventReader } from './event-gates';

/** One occurrence as a Claude Code session gets it: the text and the attributes of a `<channel>` tag. */
export type EventChannelMessage = {
  content: string;
  meta: Record<string, string>;
};

/**
 * The channel message of an occurrence of an event with `channel`: the event's `content`, or the payload as JSON,
 * and the event's `meta` under `event` (its name) and `event_id`.
 */
export function eventChannelMessage(event: EventEntry, occurrence: EventOccurrence): EventChannelMessage {
  const { channel } = event.metadata;
  const options = channel === undefined || channel === true ? {} : channel;
  const payload = occurrence.data;
  const content = options.content ? options.content(payload) : JSON.stringify(payload);
  const ownMeta = options.meta ? options.meta(payload) : {};
  return { content, meta: channelMetaOf({ ...ownMeta, event: occurrence.name, event_id: occurrence.eventId }) };
}

/**
 * Who a channel capable session reads an event as: the caller of its latest request, or an anonymous one. Undefined
 * when that caller's credentials have expired, the event is not offered to MCP clients, or the server lets no
 * anonymous caller read events.
 */
export function channelSessionReader(
  scope: ScopeEntry,
  event: EventEntry,
  session: Pick<RegisteredServer, 'caller'>,
): EventReader | undefined {
  if (hasExpiredCaller(session)) return undefined;
  if (!isOfferedOnSurface(event.metadata.availableWhen, mcpRequestSurface(scope))) return undefined;
  try {
    return eventReaderOf(scope, session.caller ?? {}, event.name, EVENT_DIALECTS['sep-3415'].errorCodes);
  } catch (error) {
    if (error instanceof EventForbiddenError) return undefined;
    throw error;
  }
}
