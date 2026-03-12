// Stub for MCP streamable HTTP transports in browser builds

export class StreamableHTTPServerTransport {
  constructor(_options?: unknown) {
    throw new Error('StreamableHTTPServerTransport is not available in browser environments');
  }
}

export class WebStandardStreamableHTTPServerTransport {
  constructor(_options?: unknown) {
    throw new Error('WebStandardStreamableHTTPServerTransport is not available in browser environments');
  }
}

// Type stubs for EventStore, EventId, StreamId
export type EventId = string;
export type StreamId = string;
export interface EventStore {
  storeEvent(streamId: StreamId, message: unknown): EventId | Promise<EventId>;
  replayEventsAfter(lastEventId: EventId, send: (eventId: EventId, message: unknown) => void): void | Promise<void>;
}
