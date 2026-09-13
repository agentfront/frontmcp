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
   * The scoped stream an event belongs to, or undefined when it is not ours.
   *
   * Ownership is resolved by ASKING the backing store, not by parsing the event
   * id: the `EventStore` contract says nothing about id format, and a store
   * returning opaque ids would otherwise make a session look like a stranger to
   * its own events and lose its replay on reconnect. Every store FrontMCP ships
   * implements the lookup.
   *
   * The prefix check below is the fallback for a store that does not, and it is
   * sound for the `<streamId>:<sequence>` shape those stores use.
   */
  const resolveOwnedStream = async (eventId: EventId): Promise<StreamId | undefined> => {
    const lookup = (store as EventStoreWithLookup).getStreamIdForEventId;
    if (lookup) {
      const resolved = await lookup.call(store, eventId);
      return resolved !== undefined && String(resolved).startsWith(prefix) ? resolved : undefined;
    }

    if (!String(eventId).startsWith(prefix)) return undefined;
    const value = String(eventId);
    const lastColon = value.lastIndexOf(':');
    return lastColon === -1 ? undefined : (value.slice(0, lastColon) as StreamId);
  };

  return {
    async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
      return store.storeEvent(scope(streamId), message);
    },

    async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
      const owned = await resolveOwnedStream(eventId);
      return owned === undefined ? undefined : unscope(owned);
    },

    async replayEventsAfter(
      lastEventId: EventId,
      options: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
    ): Promise<StreamId> {
      const owned = await resolveOwnedStream(lastEventId);
      if (owned === undefined) {
        // Another session's event id, or a forged one. Replay nothing, and hand
        // back an UNSCOPED stream id: the transport binds the caller's live SSE
        // stream to whatever comes back and may pass it to a later `storeEvent`,
        // which scopes it again — returning a scoped id here would prefix it
        // twice. Returning the requested stream would be worse still: it would
        // attach the attacker to the victim's.
        return 'default-stream' as StreamId;
      }

      return unscope(await store.replayEventsAfter(lastEventId, options));
    },
  };
}
