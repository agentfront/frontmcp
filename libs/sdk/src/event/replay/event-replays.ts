import { generateWebhookMessageId, sha256Hex } from '@frontmcp/utils';

import {
  type EventCheckItem,
  type EventCheckResult,
  type EventContext,
  type EventEntry,
  type FrontMcpLogger,
} from '../../common';
import { LeaseHolder, type LeaseStorage } from '../../duty/lease-holder';
import { type EventOutbox } from '../delivery/event-outbox';
import { EVENT_DIALECTS } from '../event-dialect';
import { newEventId } from '../event-publisher';
import { type EventReauthorization } from '../event-reauthorization';
import {
  type EventReplayState,
  type EventSubscriptionRecord,
  type EventSubscriptionStore,
} from '../subscription/event-subscription.store';

export interface EventReplaysOptions {
  store: Pick<EventSubscriptionStore, 'listByEvent' | 'update'>;
  outbox: Pick<EventOutbox, 'enqueue' | 'isPending'>;
  /** Holds the lease of each event's loop: the storage of the subscription store. */
  storage: LeaseStorage;
  /** How often `check()` is called when it names no interval of its own: `events.poll.nextPollMs`. */
  intervalMs: number;
  /** How many events one `check()` is asked for: `events.poll.maxEvents`. */
  maxEvents: number;
  /** The largest body of one delivery, in bytes. */
  maxBodyBytes: number;
  /** How long a check of a subscription's owner holds: `events.subscriptions.reauthorizeEveryMs`. */
  reauthorizeEveryMs: number;
  /** Check a subscription's owner again: the event's `authorities`, then its `authorize()`. */
  reauthorize: (event: EventEntry, record: EventSubscriptionRecord) => Promise<EventReauthorization>;
  /** End a subscription whose owner was refused, as a publish does. */
  terminate: (record: EventSubscriptionRecord) => Promise<void>;
  logger: FrontMcpLogger;
}

/** What one `check()` did to a subscription. */
export interface EventReplayStep {
  replay: EventReplayState;
  /** Whether events were skipped: the upstream cut the cursor, or `maxAgeMs` left some out. */
  truncated: boolean;
  hasMore: boolean;
  nextPollMs?: number;
}

/** How long one process holds the loop of an event before another may take it over. */
export const REPLAY_LEASE_MS = 30_000;
/** Batches with unfinished deliveries after which `check()` waits for the callback to catch up. */
export const MAX_PENDING_BATCHES = 50;
/** How many times in a row one subscription is read while `check()` answers `hasMore`. */
const MAX_ROUNDS_PER_TICK = 10;
const encoder = new TextEncoder();

/**
 * Webhook delivery for events with `check()`: one loop per event, held by one process through a lease, reads the
 * upstream for each webhook subscription and queues what it finds as deliveries. It keeps, per subscription, the
 * position it read to and the watermark a client may persist.
 */
export class EventReplays {
  private readonly holders = new Map<string, LeaseHolder>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ticks = new Map<string, Promise<void>>();
  private readonly nextCheckAt = new Map<string, number>();
  private readonly logger: FrontMcpLogger;

  /** Keep the options and name the logger. */
  constructor(private readonly options: EventReplaysOptions) {
    this.logger = options.logger.child('EventReplays');
  }

  /** Whether an event reads an upstream that can replay: it defines `check()`. */
  isReplayable(event: EventEntry): boolean {
    return typeof event.create({}).check === 'function';
  }

  /** Contend for the loop of each of these events; the process that holds an event's lease runs its loop. */
  async start(events: readonly EventEntry[]): Promise<void> {
    for (const event of events) {
      const holder = new LeaseHolder({
        label: `Webhook delivery of event "${event.name}"`,
        key: `replay-lease:${sha256Hex(event.name).slice(0, 32)}`,
        leaseMs: REPLAY_LEASE_MS,
        storage: this.options.storage,
        logger: this.logger,
        onAcquired: () => this.schedule(event, 0),
        onLost: () => this.unschedule(event.name),
      });
      this.holders.set(event.name, holder);
      await holder.start();
    }
  }

  /** Stop every loop, wait for the read in flight, and release the leases for another process to take. */
  async stop(): Promise<void> {
    for (const [eventName, holder] of this.holders) {
      this.unschedule(eventName);
      await holder.stop(() => this.ticks.get(eventName));
    }
    this.holders.clear();
  }

  /** Read the upstream for a new subscription, from the cursor of its request: `null` starts from now. */
  async begin(
    event: EventEntry,
    record: EventSubscriptionRecord,
    cursor: string | null,
    maxAgeMs: number | undefined,
  ): Promise<EventReplayStep> {
    const step = await this.advance(event, record, { cursor, watermark: cursor, pending: [] }, maxAgeMs);
    await this.options.store.update(record.id, { replay: step.replay });
    return step;
  }

  /** The state a refresh answers with: the watermark as deliveries stand now, and a gap not yet told. */
  async refresh(record: EventSubscriptionRecord, replay: EventReplayState): Promise<EventReplayStep> {
    const { truncated, ...settled } = await this.settled(replay);
    await this.options.store.update(record.id, { replay: settled });
    return { replay: settled, truncated: truncated === true, hasMore: false };
  }

  /** Run the loop of an event after `delayMs`, on a timer that does not keep the process alive. */
  private schedule(event: EventEntry, delayMs: number): void {
    const timer = setTimeout(() => {
      const tick = this.tick(event)
        .catch((error: unknown) => this.logger.warn(`The webhook loop of event "${event.name}" failed`, error))
        .finally(() => {
          this.ticks.delete(event.name);
          if (this.holders.get(event.name)?.holding) this.schedule(event, this.options.intervalMs);
        });
      this.ticks.set(event.name, tick);
    }, delayMs);
    timer.unref?.();
    this.timers.set(event.name, timer);
  }

  /** Stop the timer of an event's loop. */
  private unschedule(eventName: string): void {
    const timer = this.timers.get(eventName);
    if (timer) clearTimeout(timer);
    this.timers.delete(eventName);
  }

  /** One turn of an event's loop: read the upstream for each of its webhook subscriptions that is due. */
  private async tick(event: EventEntry): Promise<void> {
    const subscriptions = await this.options.store.listByEvent(event.name);
    for (const record of subscriptions) {
      if (!record.active || !record.replay) continue;
      if ((this.nextCheckAt.get(record.id) ?? 0) > Date.now()) continue;
      if (!(await this.isStillAuthorized(event, record))) continue;
      await this.readFor(event, record, record.replay);
    }
  }

  /**
   * Whether the owner of a subscription may still be read for: checked again once `reauthorizeEveryMs` passed. A
   * refusal ends the subscription; a check that could not be made skips it this turn, its cursor where it was.
   */
  private async isStillAuthorized(event: EventEntry, record: EventSubscriptionRecord): Promise<boolean> {
    const now = Date.now();
    if (now - record.lastAuthorizedAt <= this.options.reauthorizeEveryMs) return true;
    const check = await this.options
      .reauthorize(event, record)
      .catch((error: unknown): EventReauthorization => ({ outcome: 'failed', error }));
    if (check.outcome === 'granted') {
      await this.options.store.update(record.id, { lastAuthorizedAt: now });
      return true;
    }
    if (check.outcome === 'failed') {
      this.logger.warn(`The access of subscription ${record.id} could not be checked`, check.error);
      return false;
    }
    this.nextCheckAt.delete(record.id);
    await this.options.terminate(record);
    return false;
  }

  /** Read the upstream for one subscription until it has no more, report a gap, and store where it stands. */
  private async readFor(event: EventEntry, record: EventSubscriptionRecord, from: EventReplayState): Promise<void> {
    let replay = from;
    for (let round = 0; round < MAX_ROUNDS_PER_TICK; round++) {
      const step = await this.advance(event, record, replay, undefined);
      replay = step.truncated ? await this.reportGap(record, step.replay) : step.replay;
      this.nextCheckAt.set(record.id, Date.now() + (step.nextPollMs ?? this.options.intervalMs));
      if (!step.hasMore) break;
    }
    await this.options.store.update(record.id, { replay });
  }

  /** Tell a gap found between refreshes: an envelope for a dialect that has one, else at the next refresh. */
  private async reportGap(record: EventSubscriptionRecord, replay: EventReplayState): Promise<EventReplayState> {
    if (!EVENT_DIALECTS[record.dialect].sendsControlEnvelopes) return { ...replay, truncated: true };
    await this.options.outbox.enqueue({
      kind: 'gap',
      subscriptionId: record.id,
      eventName: record.eventName,
      body: JSON.stringify({ type: 'gap', cursor: replay.watermark }),
      webhookId: generateWebhookMessageId('gap'),
    });
    return replay;
  }

  /** Call `check()` once from the subscription's position and queue what it returned as deliveries. */
  private async advance(
    event: EventEntry,
    record: EventSubscriptionRecord,
    replay: EventReplayState,
    maxAgeMs: number | undefined,
  ): Promise<EventReplayStep> {
    const settled = await this.settled(replay);
    if (settled.pending.length >= MAX_PENDING_BATCHES) return { replay: settled, truncated: false, hasMore: false };

    const floor = settled.cursor !== null && maxAgeMs !== undefined ? Date.now() - maxAgeMs : undefined;
    const checked = await this.check(event, record, settled.cursor, floor === undefined ? undefined : maxAgeMs);
    if (!checked) return { replay: settled, truncated: false, hasMore: false };

    const deliveryIds: string[] = [];
    let skippedOldEvents = false;
    for (const item of checked.events) {
      const timestamp = item.timestamp ?? new Date().toISOString();
      if (floor !== undefined && Date.parse(timestamp) < floor) {
        skippedOldEvents = true;
        continue;
      }
      const deliveryId = await this.enqueue(event, record, item, timestamp, settled.watermark);
      if (deliveryId) deliveryIds.push(deliveryId);
    }
    const batches = [...settled.pending, { cursor: checked.cursor, deliveryIds }];
    return {
      replay: await this.settled({ ...settled, cursor: checked.cursor, pending: batches }),
      truncated: checked.truncated === true || skippedOldEvents,
      hasMore: checked.hasMore === true,
      nextPollMs: checked.nextPollMs,
    };
  }

  /** The answer of the event's `check()`; undefined, and logged, when it throws: the loop asks again later. */
  private async check(
    event: EventEntry,
    record: EventSubscriptionRecord,
    cursor: string | null,
    maxAgeMs: number | undefined,
  ): Promise<EventCheckResult<Record<string, unknown>> | undefined> {
    const context = event.create({});
    const check = context.check as NonNullable<EventContext['check']>;
    const limits = { maxEvents: this.options.maxEvents, ...(maxAgeMs !== undefined && { maxAgeMs }) };
    try {
      return await check.call(context, record.arguments, cursor, limits);
    } catch (error) {
      this.logger.warn(`check() of event "${event.name}" failed for subscription ${record.id}`, error);
      return undefined;
    }
  }

  /** Queue one item of a `check()` as a delivery whose body carries the watermark; undefined when it cannot be sent. */
  private async enqueue(
    event: EventEntry,
    record: EventSubscriptionRecord,
    item: EventCheckItem<Record<string, unknown>>,
    timestamp: string,
    watermark: string | null,
  ): Promise<string | undefined> {
    let data: Record<string, unknown>;
    try {
      data = event.parsePayload(item.data);
    } catch (error) {
      this.logger.warn(`check() of event "${event.name}" returned data that is not its payload`, error);
      return undefined;
    }
    const eventId = item.eventId ?? newEventId();
    const body = JSON.stringify({ eventId, name: event.name, timestamp, data, cursor: watermark });
    const bytes = encoder.encode(body).byteLength;
    if (bytes > this.options.maxBodyBytes) {
      this.logger.warn(
        `Event "${event.name}" is ${bytes} bytes for subscription ${record.id}, over the ` +
          `${this.options.maxBodyBytes} byte limit; it is not delivered`,
      );
      return undefined;
    }
    const usesEventId = EVENT_DIALECTS[record.dialect].webhookId === 'eventId';
    return this.options.outbox.enqueue({
      kind: 'event',
      subscriptionId: record.id,
      eventName: event.name,
      body,
      webhookId: usesEventId ? eventId : generateWebhookMessageId(),
    });
  }

  /** Move the watermark past each leading batch whose deliveries are all acknowledged, dropped or abandoned. */
  private async settled(replay: EventReplayState): Promise<EventReplayState> {
    const pending = [...replay.pending];
    let { watermark } = replay;
    while (pending.length > 0) {
      const [oldest] = pending;
      const stillPending = await Promise.all(oldest.deliveryIds.map((id) => this.options.outbox.isPending(id)));
      if (stillPending.some(Boolean)) break;
      watermark = oldest.cursor;
      pending.shift();
    }
    return { ...replay, watermark, pending };
  }
}
