import type { EventId, EventStore, JSONRPCMessage, StreamId } from '@frontmcp/protocol';

/**
 * Per-session view over a shared `EventStore` (GHSA-84j6-jc92-77jm).
 *
 * One store instance backs every MCP session on a scope, and the upstream
 * `replayEventsAfter(lastEventId, { send })` contract passes no caller identity
 * — so an implementation cannot check ownership from its arguments, and the only
 * signal available is the client-supplied event id itself.
 *
 * That is not a narrow gap. The upstream transport writes every session's
 * standalone GET/SSE notifications under the hardcoded stream id `_GET_stream`,
 * and stores number events sequentially, so `Last-Event-ID: _GET_stream:1`
 * replayed the cross-session backlog with nothing to guess. The returned
 * `StreamId` is also what the transport registers the caller's live SSE
 * controller under, so a spoofed replay additionally bound the attacker's stream
 * to the victim's key.
 *
 * The fix is placement rather than protocol: the transport already knows its
 * session id when it builds the store, so this facade namespaces every stream id
 * by session. A foreign event id then simply does not exist in this session's
 * namespace — the replay yields nothing and returns a stream this caller owns.
 */

/**
 * Separator between the session id and the transport's own stream id.
 *
 * A space cannot appear in a session id or in the transport's stream ids, and it
 * is not a Redis key separator, so the prefix is unambiguous on every backend.
 */
const SCOPE_SEPARATOR = ' ';

/**
 * `EventStore` plus the optional lookup the upstream transport uses for its
 * 409-conflict guard. No FrontMCP store implemented it, leaving that guard dead.
 */
export interface EventStoreWithLookup extends EventStore {
  getStreamIdForEventId?(eventId: EventId): Promise<StreamId | undefined>;
}

/**
 * Wrap a shared store so it only ever writes to, and only ever replays, the
 * streams belonging to `sessionId`.
 *
 * @param store - the scope-wide store every session shares.
 * @param sessionId - the owning session.
 */
export function createSessionScopedEventStore(store: EventStore, sessionId: string): EventStoreWithLookup {
  const prefix = `${sessionId}${SCOPE_SEPARATOR}`;
  const scope = (streamId: StreamId): StreamId => `${prefix}${streamId}` as StreamId;
  const unscope = (streamId: StreamId): StreamId => {
    const value = String(streamId);
    return (value.startsWith(prefix) ? value.slice(prefix.length) : value) as StreamId;
  };

  /**
   * Whether an event id was minted for this session.
   *
   * Stores build ids as `<streamId>:<sequence>`, so a scoped id carries the
   * session prefix. Anything else belongs to another session, or is forged.
   */
  const ownsEvent = (eventId: EventId): boolean => String(eventId).startsWith(prefix);

  return {
    async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
      return store.storeEvent(scope(streamId), message);
    },

    async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
      if (!ownsEvent(eventId)) return undefined;

      const inner = (store as EventStoreWithLookup).getStreamIdForEventId;
      if (!inner) {
        // Derive it from the id's own shape when the backing store offers no
        // lookup: everything before the final `:` is the stream id.
        const value = String(eventId);
        const lastColon = value.lastIndexOf(':');
        return lastColon === -1 ? undefined : unscope(value.slice(0, lastColon) as StreamId);
      }

      const resolved = await inner.call(store, eventId);
      return resolved === undefined ? undefined : unscope(resolved);
    },

    async replayEventsAfter(
      lastEventId: EventId,
      options: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
    ): Promise<StreamId> {
      if (!ownsEvent(lastEventId)) {
        // Another session's event id, or a forged one. Replay nothing — and hand
        // back a stream id in THIS session's namespace, because the transport
        // binds the caller's live SSE stream to whatever comes back. Returning
        // the requested stream would attach the attacker to the victim's.
        return scope('default-stream' as StreamId);
      }

      return unscope(await store.replayEventsAfter(lastEventId, options));
    },
  };
}
