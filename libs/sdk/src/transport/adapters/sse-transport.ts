/**
 * Custom SSEServerTransport that supports session recreation.
 *
 * When recreating a session from Redis (e.g., in serverless environments
 * or after client reconnection), we need to restore the transport's state
 * including the event ID counter for proper SSE reconnection support.
 *
 * This class extends our custom SSEServerTransport to expose a public API
 * for session recreation, maintaining the event ID sequence across reconnections.
 */
import { SSEServerTransport, SSEServerTransportOptions } from '../legacy/legacy.sse.tranporter';
import type { ServerResponse } from 'http';

export interface RecreateableSSEServerTransportOptions extends SSEServerTransportOptions {
  /**
   * Initial event ID counter value for session recreation.
   * Use this when recreating a session to restore the event ID sequence.
   */
  initialEventId?: number;
}

/**
 * SSEServerTransport with session recreation support.
 *
 * This is a drop-in replacement for SSEServerTransport that adds the ability
 * to recreate a session with preserved state. This is essential for:
 * - Serverless environments where the transport may be evicted from memory
 * - Client reconnection scenarios where event ID continuity is required
 * - Distributed systems where sessions are stored in Redis
 *
 * It extends SSEServerTransport to maintain full compatibility while
 * adding public methods to set initialization state and restore event IDs.
 */
export class RecreateableSSEServerTransport extends SSEServerTransport {
  private _isRecreatedSession = false;

  constructor(endpoint: string, res: ServerResponse, options?: RecreateableSSEServerTransportOptions) {
    super(endpoint, res, options);

    // If initialEventId is provided, restore the event counter
    if (options?.initialEventId !== undefined && options.initialEventId > 0) {
      this.setEventIdCounter(options.initialEventId);
      this._isRecreatedSession = true;
    }
  }

  /**
   * Returns whether this is a recreated session.
   */
  get isRecreatedSession(): boolean {
    return this._isRecreatedSession;
  }

  /**
   * Returns the current event ID counter value.
   * Alias for lastEventId for consistency with the recreation API.
   */
  get eventIdCounter(): number {
    return this.lastEventId;
  }

  /**
   * Sets the event ID counter for session recreation.
   * Use this when recreating a session from stored state to maintain
   * event ID continuity for SSE reconnection support.
   *
   * @param eventId - The event ID to restore (typically the last known event ID + 1)
   */
  setEventIdCounter(eventId: number): void {
    // Access the private _eventIdCounter field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)._eventIdCounter = eventId;
  }

  /**
   * Sets the transport to a recreated session state.
   * Use this when recreating a transport from a stored session.
   *
   * @param sessionId - The session ID (for verification, should match constructor)
   * @param lastEventId - The last event ID that was sent to the client
   */
  setSessionState(sessionId: string, lastEventId?: number): void {
    // Verify session ID matches (or set it if the transport allows)
    if (this.sessionId !== sessionId) {
      // The session ID is set in constructor, so this should match
      // If it doesn't, log a warning but continue
      console.warn(
        `RecreateableSSEServerTransport: session ID mismatch. ` +
          `Expected ${sessionId}, got ${this.sessionId}. Using constructor value.`,
      );
    }

    if (lastEventId !== undefined && lastEventId > 0) {
      this.setEventIdCounter(lastEventId);
    }

    this._isRecreatedSession = true;
  }
}
