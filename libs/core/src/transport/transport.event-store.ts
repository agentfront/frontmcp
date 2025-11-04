import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { EventId, EventStore, StreamId } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

type Stored = { id: EventId; msg: JSONRPCMessage };

export class InMemoryEventStore implements EventStore {
  private streams = new Map<StreamId, Stored[]>();
  private index = new Map<EventId, { streamId: StreamId; i: number }>();

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const list = this.streams.get(streamId) ?? [];
    const id = `${streamId}:${list.length + 1}` as EventId; // monotonically increasing
    const rec = { id, msg: message };
    list.push(rec);
    this.streams.set(streamId, list);
    this.index.set(id, { streamId, i: list.length - 1 });
    return id;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    const meta = this.index.get(lastEventId);
    if (!meta) {
      // Unknown lastEventId: return a default/new stream with nothing to replay.
      // You can also choose to replay from the beginning of a known stream.
      const freshStream = 'default-stream' as StreamId;
      if (!this.streams.has(freshStream)) this.streams.set(freshStream, []);
      return freshStream;
    }
    const { streamId, i } = meta;
    const list = this.streams.get(streamId) ?? [];
    for (let k = i + 1; k < list.length; k++) {
      const e = list[k];
      await send(e.id, e.msg);
    }
    return streamId;
  }
}
