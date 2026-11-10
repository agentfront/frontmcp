import type { EventDeliveryMode, EventDeliveryStatus, EventError, EventOccurrence } from '@frontmcp/protocol';

import type { EventWebhookReceiver } from './event-webhook-receiver';

/** A notification of an `events/stream`, as the transport received it. */
export interface EventsStreamNotification {
  method: string;
  params?: Record<string, unknown>;
}

/** How the events client reaches a server: JSON-RPC requests, and optionally a long-lived `events/stream`. */
export interface EventsClientTransport {
  /** Send one request; resolve with its result, or reject with an `EventRequestError` for a JSON-RPC error. */
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  /**
   * Hold an `events/stream` request open and hand each of its notifications to `onNotification`. Resolves when the
   * stream ends or `signal` aborts it; rejects with an `EventRequestError` when the server refuses it. Absent when the
   * transport cannot hold a stream.
   */
  openStream?(
    params: Record<string, unknown>,
    onNotification: (notification: EventsStreamNotification) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

/** Where the cursor of each subscription is kept between runs. Nothing is persisted by default. */
export interface EventCursorStore {
  /** The cursor last kept under `key`; undefined when none was. */
  get(key: string): Promise<string | null | undefined> | string | null | undefined;
  /** Keep the latest cursor under `key`. */
  set(key: string, cursor: string | null): Promise<void> | void;
}

/** Where webhook deliveries arrive: a callback URL and the receiver that answers it. */
export interface EventsWebhookConfig {
  /** The `https` callback URL the server POSTs to. */
  url: string;
  /** The receiver behind that URL; each subscription registers the secret it generates with it. */
  receiver: EventWebhookReceiver;
  /** The lifetime suggested on subscribe; omitted asks for the server default, `null` for no expiry. */
  ttlMs?: number | null;
}

export interface EventsClientOptions {
  /** Enables webhook delivery, which is then preferred where the event offers it. */
  webhook?: EventsWebhookConfig;
  /** Keeps cursors across runs. @default an in-memory store */
  cursorStore?: EventCursorStore;
  /** The shortest wait between two polls, and between two reconnections. @default 1000 */
  pollFloorMs?: number;
  /** A push stream silent for this long is treated as dead and reopened from its cursor. @default 60000 */
  heartbeatTimeoutMs?: number;
}

export interface EventSubscribeOptions {
  /** Force a delivery mode instead of choosing one. */
  delivery?: EventDeliveryMode;
  /** Where to start; `null` is "from now". @default the cursor store's, else `null` */
  cursor?: string | null;
  /** Do not replay events older than this, in milliseconds. */
  maxAgeMs?: number;
  /** The most events one poll returns. */
  maxEvents?: number;
  /** Told when the server skipped events and delivery goes on from `cursor`. */
  onTruncated?: (cursor: string | null) => void;
  /** Told of a recoverable failure the server reported; the subscription stays open. */
  onError?: (error: EventError) => void;
}

/** A live subscription: an async iterable of the occurrences it receives, until it is cancelled or terminated. */
export interface EventSubscription extends AsyncIterable<EventOccurrence> {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  /** The delivery mode in use. */
  readonly mode: EventDeliveryMode;
  /** The latest cursor received. */
  readonly cursor: string | null;
  /** The id the server derived, for a webhook subscription. */
  readonly id: string | undefined;
  /** What the last subscribe or refresh said about webhook delivery. */
  readonly deliveryStatus: EventDeliveryStatus | undefined;
  /** End the subscription: the iteration completes and the server is told where the mode allows it. */
  cancel(): Promise<void>;
}
