import {
  EventErrorSchema,
  EventOccurrenceSchema,
  EVENTS_ERROR_CODES,
  EVENTS_METHODS,
  EVENTS_NOTIFICATIONS,
  EVENTS_SKETCH_ERROR_CODES,
  ListEventsResultSchema,
  PollEventsResultSchema,
  SubscribeEventResultSchema,
  type EventDefinition,
  type EventDeliveryMode,
  type EventDeliveryStatus,
  type EventError,
  type EventOccurrence,
} from '@frontmcp/protocol';
import { canonicalJson, generateStandardWebhookSecret } from '@frontmcp/utils';

import { listAllPages } from '../common/utils/list-all-pages.utils';
import {
  EventRequestError,
  EventSubscriptionTerminatedError,
  NoCompatibleDeliveryModeError,
} from './event-client.errors';
import type { EventWebhookRegistration } from './event-webhook-receiver';
import type {
  EventCursorStore,
  EventsClientOptions,
  EventsClientTransport,
  EventsStreamNotification,
  EventSubscribeOptions,
  EventSubscription,
  EventsWebhookConfig,
} from './events-client.types';

export const DEFAULT_POLL_FLOOR_MS = 1000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60000;
/** How often a subscription granted no expiry is refreshed anyway, to read its cursor and delivery status. */
export const NO_EXPIRY_REFRESH_MS = 3_600_000;
/** A webhook subscription is refreshed once this share of its remaining lifetime has passed. */
const REFRESH_AT_SHARE = 0.8;
/** The event ids one subscription remembers to drop duplicates. */
const DEDUPE_WINDOW = 1000;

/** Codes that end a subscription: invalid arguments and every events error, in both dialects. */
const TERMINAL_CODES = new Set<number>([
  -32602,
  ...Object.values(EVENTS_ERROR_CODES),
  ...Object.values(EVENTS_SKETCH_ERROR_CODES),
]);

/** Whether an error means the server will not serve the subscription, so retrying cannot help. */
function isTerminal(error: unknown): error is EventRequestError {
  return error instanceof EventRequestError && TERMINAL_CODES.has(error.rpcCode);
}

/** The error a terminated subscription reports for a refusal. */
function eventErrorOf(error: EventRequestError): EventError {
  const data = typeof error.data === 'object' && error.data !== null ? (error.data as Record<string, unknown>) : {};
  return { code: error.rpcCode, message: error.message, data };
}

/** Wait `ms`, or less when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Cursors kept in memory, for one client's lifetime. */
class MemoryCursorStore implements EventCursorStore {
  private readonly cursors = new Map<string, string | null>();

  /** The cursor kept under `key`. */
  get(key: string): string | null | undefined {
    return this.cursors.get(key);
  }

  /** Keep `cursor` under `key`. */
  set(key: string, cursor: string | null): void {
    this.cursors.set(key, cursor);
  }
}

/** The occurrences of one subscription, deduplicated by `eventId`, consumed by one async iteration. */
class OccurrenceQueue implements AsyncIterable<EventOccurrence> {
  private readonly items: EventOccurrence[] = [];
  private readonly seen = new Set<string>();
  private waiter?: { resolve: (result: IteratorResult<EventOccurrence>) => void; reject: (error: Error) => void };
  private ended = false;
  private failure?: Error;

  /** Calls `onReturn` when the consumer leaves the iteration early. */
  constructor(private readonly onReturn: () => Promise<void>) {}

  /** Queue an occurrence, unless it was seen or the queue ended. */
  push(occurrence: EventOccurrence): void {
    if (this.ended || this.seen.has(occurrence.eventId)) return;
    this.seen.add(occurrence.eventId);
    if (this.seen.size > DEDUPE_WINDOW) this.seen.delete(this.seen.values().next().value as string);
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) waiter.resolve({ value: occurrence, done: false });
    else this.items.push(occurrence);
  }

  /** End the iteration: at once when cancelled, or with `failure` once the queued occurrences are read. */
  end(failure?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = failure;
    if (!failure) this.items.length = 0;
    const waiter = this.waiter;
    this.waiter = undefined;
    if (!waiter) return;
    if (failure) waiter.reject(failure);
    else waiter.resolve({ value: undefined, done: true });
  }

  /** The iterator of the queue. */
  [Symbol.asyncIterator](): AsyncIterator<EventOccurrence> {
    return {
      next: () => this.next(),
      return: async () => {
        await this.onReturn();
        return { value: undefined, done: true };
      },
    };
  }

  /** The next occurrence, once there is one. */
  private next(): Promise<IteratorResult<EventOccurrence>> {
    const item = this.items.shift();
    if (item) return Promise.resolve({ value: item, done: false });
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }
}

interface SubscriptionSettings {
  transport: EventsClientTransport;
  cursorStore: EventCursorStore;
  pollFloorMs: number;
  heartbeatTimeoutMs: number;
  webhook: EventsWebhookConfig | undefined;
  name: string;
  arguments: Record<string, unknown>;
  mode: EventDeliveryMode;
  cursor: string | null;
  options: EventSubscribeOptions;
}

/** One subscription of the client, run in the mode it was given. */
class ClientEventSubscription implements EventSubscription {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly mode: EventDeliveryMode;
  cursor: string | null;
  id: string | undefined;
  deliveryStatus: EventDeliveryStatus | undefined;
  private readonly queue: OccurrenceQueue;
  private readonly stopController = new AbortController();
  private streamController?: AbortController;
  private registration?: EventWebhookRegistration;
  private secret?: string;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private firstRequest = true;

  /** A subscription that does nothing until `start()`. */
  constructor(private readonly settings: SubscriptionSettings) {
    this.name = settings.name;
    this.arguments = settings.arguments;
    this.mode = settings.mode;
    this.cursor = settings.cursor;
    this.queue = new OccurrenceQueue(() => this.cancel());
  }

  /** The iterator of its occurrences. */
  [Symbol.asyncIterator](): AsyncIterator<EventOccurrence> {
    return this.queue[Symbol.asyncIterator]();
  }

  /** Whether it was cancelled or terminated. */
  private get stopped(): boolean {
    return this.stopController.signal.aborted;
  }

  /** Make the first request of the mode; rejects when the server refuses the subscription. */
  async start(): Promise<void> {
    if (this.mode === 'poll') {
      const waitMs = await this.pollOnce();
      void this.pollLoop(waitMs);
    } else if (this.mode === 'push') {
      await this.openStream();
    } else {
      await this.startWebhook();
    }
  }

  /** End the subscription and tell the server where the mode allows it. */
  async cancel(): Promise<void> {
    if (this.stopped) return;
    this.stop();
    this.queue.end();
    if (this.mode !== 'webhook') return;
    const delivery = { mode: 'webhook', url: this.settings.webhook?.url };
    await this.settings.transport
      .request(EVENTS_METHODS.unsubscribe, { name: this.name, arguments: this.arguments, delivery })
      .catch(() => undefined);
  }

  /** Stop every loop, stream and timer, and release the webhook secret. */
  private stop(): void {
    this.stopController.abort();
    this.streamController?.abort();
    clearTimeout(this.refreshTimer);
    this.registration?.release();
  }

  /** End the subscription because the server ended it. */
  private terminate(error: EventError): void {
    if (this.stopped) return;
    this.stop();
    this.queue.end(new EventSubscriptionTerminatedError(this.name, error));
  }

  /** Keep a cursor the server sent, and report a skip. */
  private advance(cursor: string | null | undefined, truncated?: boolean): void {
    this.cursor = cursor ?? null;
    const key = canonicalJson({ name: this.name, arguments: this.arguments });
    Promise.resolve(this.settings.cursorStore.set(key, this.cursor)).catch(() => undefined);
    if (truncated) this.settings.options.onTruncated?.(this.cursor);
  }

  /** The parameters every request of the subscription carries, with the replay bound on the first one only. */
  private subscriptionParams(): Record<string, unknown> {
    const { maxAgeMs } = this.settings.options;
    const params: Record<string, unknown> = { name: this.name, arguments: this.arguments, cursor: this.cursor };
    if (this.firstRequest && maxAgeMs !== undefined) params['maxAgeMs'] = maxAgeMs;
    this.firstRequest = false;
    return params;
  }

  /** One `events/poll`; answers how long to wait before the next one. */
  private async pollOnce(): Promise<number> {
    const { maxEvents } = this.settings.options;
    const params = { ...this.subscriptionParams(), ...(maxEvents !== undefined && { maxEvents }) };
    const result = PollEventsResultSchema.parse(await this.settings.transport.request(EVENTS_METHODS.poll, params));
    this.advance(result.cursor, result.truncated);
    for (const occurrence of result.events) this.queue.push(occurrence);
    if (result.hasMore) return 0;
    return Math.max(result.nextPollMs ?? this.settings.pollFloorMs, this.settings.pollFloorMs);
  }

  /** Poll until stopped: at once while the server has more, else after the interval it recommends. */
  private async pollLoop(firstWaitMs: number): Promise<void> {
    let waitMs = firstWaitMs;
    while (!this.stopped) {
      await sleep(waitMs, this.stopController.signal);
      if (this.stopped) return;
      try {
        waitMs = await this.pollOnce();
      } catch (error) {
        if (isTerminal(error)) return this.terminate(eventErrorOf(error));
        waitMs = Math.max(waitMs, this.settings.pollFloorMs);
      }
    }
  }

  /** Open an `events/stream`; resolves once the server confirms it, rejects when it refuses it. */
  private openStream(): Promise<void> {
    const { transport } = this.settings;
    const openStream = (transport.openStream as NonNullable<EventsClientTransport['openStream']>).bind(transport);
    const controller = new AbortController();
    this.streamController = controller;
    let confirmed = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const resetWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), this.settings.heartbeatTimeoutMs);
    };

    return new Promise<void>((confirm, refuse) => {
      const onNotification = (notification: EventsStreamNotification) => {
        resetWatchdog();
        if (notification.method === EVENTS_NOTIFICATIONS.active) {
          confirmed = true;
          confirm();
        }
        this.onStreamNotification(notification);
      };
      resetWatchdog();
      openStream({ ...this.subscriptionParams() }, onNotification, controller.signal).then(
        () => this.streamEnded(confirmed, watchdog, refuse, undefined),
        (error: unknown) => this.streamEnded(confirmed, watchdog, refuse, error),
      );
    });
  }

  /** After a stream ended: refuse a stream never confirmed, else reconnect unless the subscription is over. */
  private streamEnded(
    confirmed: boolean,
    watchdog: ReturnType<typeof setTimeout> | undefined,
    refuse: (error: unknown) => void,
    error: unknown,
  ): void {
    clearTimeout(watchdog);
    if (!confirmed) return refuse(error ?? new Error('The events/stream ended before the server confirmed it'));
    if (!this.stopped) void this.reconnect();
  }

  /** Reopen the stream from the latest cursor, until it is confirmed or the subscription is over. */
  private async reconnect(): Promise<void> {
    while (!this.stopped) {
      await sleep(this.settings.pollFloorMs, this.stopController.signal);
      if (this.stopped) return;
      try {
        await this.openStream();
        return;
      } catch (error) {
        if (isTerminal(error)) return this.terminate(eventErrorOf(error));
      }
    }
  }

  /** Act on one notification of the stream. */
  private onStreamNotification({ method, params = {} }: EventsStreamNotification): void {
    if (method === EVENTS_NOTIFICATIONS.active) {
      this.advance(params['cursor'] as string | null | undefined, params['truncated'] === true);
    } else if (method === EVENTS_NOTIFICATIONS.heartbeat) {
      this.advance(params['cursor'] as string | null | undefined);
    } else if (method === EVENTS_NOTIFICATIONS.event) {
      const { _meta: _subscriptionMeta, ...fields } = params;
      const occurrence = EventOccurrenceSchema.safeParse(fields);
      if (!occurrence.success) return;
      this.advance(occurrence.data.cursor);
      this.queue.push(occurrence.data);
    } else if (method === EVENTS_NOTIFICATIONS.error || method === EVENTS_NOTIFICATIONS.terminated) {
      const error = EventErrorSchema.safeParse(params['error']);
      if (!error.success) return;
      if (method === EVENTS_NOTIFICATIONS.error) this.settings.options.onError?.(error.data);
      else this.terminate(error.data);
    }
  }

  /** Register a fresh secret with the receiver, then subscribe. */
  private async startWebhook(): Promise<void> {
    const webhook = this.settings.webhook as EventsWebhookConfig;
    const secret = generateStandardWebhookSecret();
    this.secret = secret;
    this.registration = webhook.receiver.register({
      secret,
      listener: {
        onEvent: (occurrence) => {
          this.advance(occurrence.cursor);
          this.queue.push(occurrence);
        },
        onGap: (cursor) => this.advance(cursor, true),
        onTerminated: (error) => this.terminate(error),
      },
    });
    try {
      await this.refresh();
    } catch (error) {
      this.registration.release();
      throw error;
    }
  }

  /** `events/subscribe`: create the subscription or keep it alive, then schedule the next refresh. */
  private async refresh(): Promise<void> {
    const webhook = this.settings.webhook as EventsWebhookConfig;
    const params = {
      ...this.subscriptionParams(),
      delivery: { mode: 'webhook', url: webhook.url, secret: this.secret },
      ...(webhook.ttlMs !== undefined && { ttlMs: webhook.ttlMs }),
    };
    const result = SubscribeEventResultSchema.parse(
      await this.settings.transport.request(EVENTS_METHODS.subscribe, params),
    );
    this.id = result.id;
    (this.registration as EventWebhookRegistration).bind(result.id);
    this.deliveryStatus = result.deliveryStatus;
    this.advance(result.cursor, result.truncated);
    if (this.stopped) return;
    const remainingMs = result.refreshBefore === null ? undefined : Date.parse(result.refreshBefore) - Date.now();
    const delayMs = remainingMs === undefined ? NO_EXPIRY_REFRESH_MS : remainingMs * REFRESH_AT_SHARE;
    this.scheduleRefresh(Math.max(delayMs, this.settings.pollFloorMs));
  }

  /** Refresh after `delayMs`; a failed refresh is retried, a refused one ends the subscription. */
  private scheduleRefresh(delayMs: number): void {
    this.refreshTimer = setTimeout(() => {
      this.refresh().catch((error: unknown) => {
        if (isTerminal(error)) this.terminate(eventErrorOf(error));
        else if (!this.stopped) this.scheduleRefresh(this.settings.pollFloorMs);
      });
    }, delayMs);
  }
}

/**
 * The events API of an MCP client (MCP Events, SEP-3415): list the event types, and subscribe to one. A subscription
 * picks its delivery mode (webhook when a receiver is configured, else push when the transport streams, else poll)
 * and yields the occurrences it receives, deduplicated by `eventId`.
 */
export class EventsClient {
  private readonly cursorStore: EventCursorStore;
  private definitions?: Map<string, EventDefinition>;

  /** A client sending its requests through `transport`. */
  constructor(
    private readonly transport: EventsClientTransport,
    private readonly options: EventsClientOptions = {},
  ) {
    this.cursorStore = options.cursorStore ?? new MemoryCursorStore();
  }

  /** Every event type the server lists to this caller, all pages. */
  async list(): Promise<EventDefinition[]> {
    const events = await listAllPages(EVENTS_METHODS.list, async (cursor) => {
      const result = ListEventsResultSchema.parse(
        await this.transport.request(EVENTS_METHODS.list, cursor ? { cursor } : {}),
      );
      return { items: result.events, nextCursor: result.nextCursor };
    });
    this.definitions = new Map(events.map((definition) => [definition.name, definition]));
    return events;
  }

  /** Subscribe to an event; resolves once the server accepted the subscription, rejects when it refuses it. */
  async subscribe(
    name: string,
    args: Record<string, unknown> = {},
    options: EventSubscribeOptions = {},
  ): Promise<EventSubscription> {
    const mode = await this.modeFor(name, options.delivery);
    const storedCursor = await this.cursorStore.get(canonicalJson({ name, arguments: args }));
    const subscription = new ClientEventSubscription({
      transport: this.transport,
      cursorStore: this.cursorStore,
      pollFloorMs: this.options.pollFloorMs ?? DEFAULT_POLL_FLOOR_MS,
      heartbeatTimeoutMs: this.options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      webhook: this.options.webhook,
      name,
      arguments: args,
      mode,
      cursor: options.cursor !== undefined ? options.cursor : (storedCursor ?? null),
      options,
    });
    await subscription.start();
    return subscription;
  }

  /** The delivery mode of a new subscription: the forced one, or the first the event offers and this client can use. */
  private async modeFor(name: string, forced: EventDeliveryMode | undefined): Promise<EventDeliveryMode> {
    const usable: EventDeliveryMode[] = [];
    if (this.options.webhook) usable.push('webhook');
    if (this.transport.openStream) usable.push('push');
    usable.push('poll');
    if (!this.definitions) await this.list();
    const offered = this.definitions?.get(name)?.delivery ?? usable;
    const mode = forced ?? usable.find((candidate) => offered.includes(candidate));
    if (!mode || !usable.includes(mode) || !offered.includes(mode)) {
      throw new NoCompatibleDeliveryModeError(name, offered, usable);
    }
    return mode;
  }
}
