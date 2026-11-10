import {
  EventOccurrenceSchema,
  EVENTS_NOTIFICATIONS,
  MCP_20260728_META,
  type EventError,
  type EventOccurrence,
} from '@frontmcp/protocol';

import {
  type EventCheckResult,
  type EventContext,
  type EventEntry,
  type EventSubscriptionRef,
  type FrontMcpLogger,
} from '../../common';
import { type EventReader } from '../event-gates';
import { newEventId } from '../event-publisher';
import { type EventReauthorization } from '../event-reauthorization';
import { isInAudience } from '../flows/event-publish.flow';
import { type BufferedEvent, type EventBuffer } from '../poll/event-buffer';

/** A notification of one stream, as it is sent to the client. */
export interface EventStreamNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface EventStreamOptions {
  /** The JSON-RPC id of the `events/stream` request: every notification carries it. */
  requestId: string | number;
  event: EventEntry;
  context: EventContext;
  reader: EventReader;
  subscription: EventSubscriptionRef;
  arguments: Record<string, unknown>;
  /** The cursor of the request; `null` or none starts from now. */
  cursor: string | null | undefined;
  maxAgeMs: number | undefined;
  /** The published occurrences a cursor replays from; none for an event with `check()`. */
  buffer: EventBuffer | undefined;
  /** `events.push.heartbeatMs`. */
  heartbeatMs: number;
  /** How often `check()` is called when it names no interval of its own. */
  checkIntervalMs: number;
  /** How many events one `check()` is asked for. */
  checkMaxEvents: number;
  /** How often the reader's access is checked again. */
  reauthorizeEveryMs: number;
  /** Check the reader again: its event's `authorities`, then its `authorize()`. */
  reauthorize: () => Promise<EventReauthorization>;
  /** The error a stream whose reader lost access ends with. */
  accessRevoked: EventError;
  /** Ends the stream when the client cancels the request or disconnects. */
  signal: AbortSignal | undefined;
  logger: FrontMcpLogger;
}

/** Notifications waiting for a slow client; past it the stream reports a gap instead of growing. */
export const MAX_QUEUED_NOTIFICATIONS = 1000;

/**
 * One open `events/stream` request: `active` first, then an `event` for each occurrence its reader may receive, a
 * `heartbeat` while it is quiet, and `terminated` when the server ends it. It is consumed as an async iterable.
 */
export class EventStream implements AsyncIterable<EventStreamNotification> {
  private readonly queue: EventStreamNotification[] = [];
  private readonly closeListeners: Array<() => void> = [];
  private wake?: () => void;
  private closed = false;
  private cursor: string | null;
  private lastAuthorizedAt = Date.now();
  /** The last check of the reader's access could not be made: nothing is delivered until one is. */
  private accessUnchecked = false;
  /** Published events were held back while the access was unchecked. */
  private withheld = false;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private checkTimer?: ReturnType<typeof setTimeout>;
  /** Offers are delivered one after the other, in the order they came; behind the replay while the stream opens. */
  private delivering: Promise<void>;
  private releaseDelivery: () => void = () => undefined;
  /** The buffer sequence of the last occurrence taken: one replayed and offered live too is delivered once. */
  private lastSequence = 0;

  constructor(private readonly options: EventStreamOptions) {
    this.cursor = options.cursor ?? null;
    this.delivering = options.buffer
      ? new Promise<void>((resolve) => (this.releaseDelivery = resolve))
      : Promise.resolve();
    if (options.signal?.aborted) this.close();
    else options.signal?.addEventListener('abort', () => this.close(), { once: true });
  }

  /** The subscription this stream stands for. */
  get subscription(): EventSubscriptionRef {
    return this.options.subscription;
  }

  /** The name of the event the stream carries. */
  get eventName(): string {
    return this.options.event.name;
  }

  /** The owner's key; undefined for an anonymous reader. */
  get principalKey(): string | undefined {
    return this.options.reader.principalKey;
  }

  /** Whether the stream has ended. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Confirm the stream, replay what the cursor asks for, and start the heartbeat and, with `check()`, its loop. */
  async open(): Promise<void> {
    const { context, heartbeatMs } = this.options;
    if (context.check) {
      await this.openOnCheck();
    } else {
      await this.openOnBuffer();
    }
    this.releaseDelivery();
    if (this.closed) return;
    this.heartbeatTimer = setInterval(() => void this.beat(), heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  /** Deliver a published occurrence, when it is for this stream's reader and arguments, after those offered before. */
  offer(buffered: BufferedEvent): Promise<void> {
    this.delivering = this.delivering
      .then(() => this.deliver(buffered))
      .catch((error: unknown) =>
        this.options.logger.warn(`An event was not delivered on stream ${this.subscription.id}`, error),
      );
    return this.delivering;
  }

  /** End the stream on the server's side: the client gets `terminated` with the reason, then the final frame. */
  terminate(error: EventError): void {
    if (this.closed) return;
    this.push(EVENTS_NOTIFICATIONS.terminated, { error });
    this.close();
  }

  /** End the stream: stop its timers and let the consumer drain what is queued. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseDelivery();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.checkTimer) clearTimeout(this.checkTimer);
    for (const listener of this.closeListeners.splice(0)) listener();
    this.wake?.();
  }

  /** Call `listener` once, when the stream ends. */
  onClose(listener: () => void): void {
    if (this.closed) listener();
    else this.closeListeners.push(listener);
  }

  /** The notifications of the stream, in order, until it ends. A reader that stops reading ends the stream. */
  [Symbol.asyncIterator](): AsyncIterator<EventStreamNotification> {
    return {
      next: () => this.nextNotification(),
      return: async () => {
        this.close();
        return { value: undefined, done: true };
      },
    };
  }

  /** The next queued notification, waiting for one while the stream is open. */
  private async nextNotification(): Promise<IteratorResult<EventStreamNotification>> {
    for (;;) {
      const queued = this.queue.shift();
      if (queued) return { value: queued, done: false };
      if (this.closed) return { value: undefined, done: true };
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }

  /** Start a stream of published events: from now, or replaying the buffer after the request's cursor. */
  private async openOnBuffer(): Promise<void> {
    const { buffer, cursor, maxAgeMs } = this.options;
    if (!buffer) {
      this.pushActive(false);
      return;
    }
    if (cursor === undefined || cursor === null) {
      this.cursor = buffer.currentCursor();
      this.lastSequence = buffer.currentSequence();
      this.pushActive(false);
      return;
    }
    const read = buffer.read(this.eventName, cursor);
    const endCursor = buffer.currentCursor();
    const endSequence = buffer.currentSequence();
    const floor = maxAgeMs === undefined ? undefined : Date.now() - maxAgeMs;
    const replayed = read.events.filter((buffered) => floor === undefined || buffered.publishedAt >= floor);
    this.cursor = read.events.length === 0 ? endCursor : cursor;
    this.pushActive(read.truncated || replayed.length < read.events.length);
    for (const buffered of replayed) await this.deliver(buffered);
    this.cursor = endCursor;
    this.lastSequence = endSequence;
  }

  /** Deliver one occurrence not taken yet; the cursor moves only on a stream of published events. */
  private async deliver(buffered: BufferedEvent): Promise<void> {
    if (this.closed || buffered.sequence <= this.lastSequence) return;
    if (this.accessUnchecked) {
      this.withheld = true;
      return;
    }
    this.lastSequence = buffered.sequence;
    const occurrence = await this.occurrenceFor(buffered);
    if (!occurrence) return;
    const { buffer } = this.options;
    if (buffer) this.cursor = buffer.cursorAt(buffered.sequence);
    this.pushEvent(occurrence);
  }

  /** Start a stream of an event with `check()`: ask it for the position or the backlog, then keep asking. */
  private async openOnCheck(): Promise<void> {
    const checked = await this.check();
    this.pushActive(checked?.truncated === true);
    if (checked) this.pushChecked(checked);
    this.scheduleCheck(checked?.nextPollMs);
  }

  /** Call the event's `check()` from the stream's cursor; a failure is reported on the stream, which stays open. */
  private async check(): Promise<EventCheckResult<Record<string, unknown>> | undefined> {
    const { context, checkMaxEvents, maxAgeMs } = this.options;
    const check = context.check as NonNullable<EventContext['check']>;
    const limits = { maxEvents: checkMaxEvents, ...(this.cursor !== null && maxAgeMs !== undefined && { maxAgeMs }) };
    try {
      const checked = await check.call(context, this.options.arguments, this.cursor, limits);
      this.cursor = checked.cursor;
      return checked;
    } catch (error) {
      this.options.logger.warn(`check() of event "${this.eventName}" failed for stream ${this.subscription.id}`, error);
      this.push(EVENTS_NOTIFICATIONS.error, {
        error: { code: -32603, message: 'UpstreamError', data: { reason: 'check() failed' } },
      });
      return undefined;
    }
  }

  /** Call `check()` again after its interval, for as long as the stream is open. */
  private scheduleCheck(nextPollMs: number | undefined): void {
    if (this.closed) return;
    this.checkTimer = setTimeout(() => void this.runCheck(), nextPollMs ?? this.options.checkIntervalMs);
    this.checkTimer.unref?.();
  }

  /** One turn of the `check()` loop: deliver what it found, report a gap, and schedule the next turn. */
  private async runCheck(): Promise<void> {
    if (this.accessUnchecked) {
      this.scheduleCheck(undefined);
      return;
    }
    const checked = await this.check();
    if (checked?.truncated) this.pushActive(true);
    if (checked) this.pushChecked(checked);
    this.scheduleCheck(checked?.hasMore ? 0 : checked?.nextPollMs);
  }

  /** Deliver the items a `check()` returned, each validated against the payload schema. */
  private pushChecked(checked: EventCheckResult<Record<string, unknown>>): void {
    const { event } = this.options;
    for (const item of checked.events) {
      try {
        this.pushEvent({
          eventId: item.eventId ?? newEventId(),
          name: event.name,
          timestamp: item.timestamp ?? new Date().toISOString(),
          data: event.parsePayload(item.data),
        });
      } catch (error) {
        this.options.logger.warn(`check() of event "${event.name}" returned data that is not its payload`, error);
      }
    }
  }

  /** A published occurrence as this stream's reader receives it; undefined when it is not for it. */
  private async occurrenceFor(buffered: BufferedEvent): Promise<EventOccurrence | undefined> {
    const { context, reader, subscription } = this.options;
    const { occurrence } = buffered;
    if (buffered.subscriptionId !== undefined && buffered.subscriptionId !== subscription.id) return undefined;
    if (!isInAudience(buffered.audience, reader.subscriber)) return undefined;
    try {
      const matches = (await context.match?.(occurrence, this.options.arguments, reader.subscriber)) ?? true;
      if (!matches) return undefined;
      if (!context.transform) return occurrence;
      const transformed = await context.transform(occurrence, this.options.arguments, reader.subscriber);
      return EventOccurrenceSchema.parse(transformed);
    } catch (error) {
      this.options.logger.warn(`Event "${occurrence.name}" failed for stream ${subscription.id}`, error);
      return undefined;
    }
  }

  /** The heartbeat: the cursor to persist while nothing happens, and the moment access is checked again. */
  private async beat(): Promise<void> {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.lastAuthorizedAt > this.options.reauthorizeEveryMs) {
      const check = await this.options
        .reauthorize()
        .catch((error: unknown): EventReauthorization => ({ outcome: 'failed', error }));
      if (check.outcome === 'refused') {
        this.terminate(this.options.accessRevoked);
        return;
      }
      if (check.outcome === 'failed') {
        this.accessUnchecked = true;
        this.options.logger.warn(`The access of stream ${this.subscription.id} could not be checked`, check.error);
      } else {
        this.lastAuthorizedAt = now;
        this.resumeAfterCheck();
      }
    }
    this.push(EVENTS_NOTIFICATIONS.heartbeat, { cursor: this.cursor });
  }

  /** Deliver again after a check that could not be made; held-back events are reported as a gap from the cursor. */
  private resumeAfterCheck(): void {
    if (!this.accessUnchecked) return;
    this.accessUnchecked = false;
    if (this.withheld) this.pushActive(true);
    this.withheld = false;
  }

  /** Queue the confirmation of the stream, or of a gap in it, with the cursor delivery continues from. */
  private pushActive(truncated: boolean): void {
    this.push(EVENTS_NOTIFICATIONS.active, { cursor: this.cursor, truncated });
  }

  /** Queue one occurrence, with the cursor after it. */
  private pushEvent(occurrence: EventOccurrence): void {
    this.push(EVENTS_NOTIFICATIONS.event, { ...occurrence, cursor: this.cursor });
  }

  /** Queue a notification tagged with the stream's id; a queue a slow client let fill up is replaced by a gap. */
  private push(method: string, params: Record<string, unknown>): void {
    if (this.closed) return;
    const meta = { [MCP_20260728_META.subscriptionId]: this.options.requestId };
    if (this.queue.length >= MAX_QUEUED_NOTIFICATIONS) {
      this.queue.length = 0;
      this.queue.push({
        method: EVENTS_NOTIFICATIONS.active,
        params: { cursor: this.cursor, truncated: true, _meta: meta },
      });
    }
    this.queue.push({ method, params: { ...params, _meta: meta } });
    this.wake?.();
  }
}
