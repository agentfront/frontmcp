import { internalZ as z } from '@frontmcp/lazy-zod';
import { EVENTS_METHODS, MCP_20260728_META } from '@frontmcp/protocol';

import { EventRequestError, type EventsClientTransport, type EventsStreamNotification } from '../event-client';

/** The longest timer a runtime accepts: an `events/stream` has no request timeout, its heartbeat is its liveness. */
const NO_TIMEOUT_MS = 2_147_483_647;
const anyResultSchema = z.record(z.string(), z.unknown());

/** What the events transport needs of the MCP protocol client. */
export interface ProtocolRequester {
  /** Send a request and resolve with its result parsed by `resultSchema`. */
  request(
    request: { method: string; params: Record<string, unknown> },
    resultSchema: unknown,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<unknown>;
}

/** Listens to every notification the client receives; returns the function that stops listening. */
export type NotificationSource = (handler: (notification: { method: string; params?: unknown }) => void) => () => void;

/** An `EventRequestError` for an MCP error, without the "MCP error <code>:" prefix the protocol client adds. */
function requestErrorOf(method: string, error: unknown): unknown {
  const { code, message, data } = (error ?? {}) as { code?: unknown; message?: unknown; data?: unknown };
  if (typeof code !== 'number') return error;
  const text = typeof message === 'string' ? message.replace(/^MCP error -?\d+: /, '') : '';
  return new EventRequestError(method, code, text, data);
}

/** The events transport of a protocol client connected in process: requests, and `events/stream` routed by its id. */
export function directEventsTransport(
  client: ProtocolRequester,
  notifications: NotificationSource,
): EventsClientTransport {
  return {
    /** Send one events request, turning an MCP error into an EventRequestError. */
    async request(method, params) {
      try {
        return await client.request({ method, params }, anyResultSchema);
      } catch (error) {
        throw requestErrorOf(method, error);
      }
    },

    /** Hold an events/stream until it ends or `signal` aborts, passing on the notifications of its id. */
    async openStream(params, onNotification, signal) {
      // The protocol client numbers its requests itself; the next number is the id this stream will carry
      const requestId = (client as unknown as { _requestMessageId?: unknown })._requestMessageId;
      if (typeof requestId !== 'number') throw new Error('This MCP client cannot hold an events/stream');
      const stopListening = notifications((notification) => {
        const meta = (notification.params as { _meta?: Record<string, unknown> } | undefined)?._meta;
        if (meta?.[MCP_20260728_META.subscriptionId] !== requestId) return;
        onNotification(notification as EventsStreamNotification);
      });
      try {
        await client.request({ method: EVENTS_METHODS.stream, params }, anyResultSchema, {
          signal,
          timeout: NO_TIMEOUT_MS,
        });
      } catch (error) {
        if (!signal.aborted) throw requestErrorOf(EVENTS_METHODS.stream, error);
      } finally {
        stopListening();
      }
    },
  };
}
