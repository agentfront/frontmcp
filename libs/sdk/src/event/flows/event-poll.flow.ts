import { internalZ as z } from '@frontmcp/lazy-zod';
import {
  EventOccurrenceSchema,
  PollEventsRequestSchema,
  PollEventsResultSchema,
  type AuthInfo,
  type EventOccurrence,
  type PollEventsResult,
} from '@frontmcp/protocol';

import {
  EventEntry,
  Flow,
  FlowBase,
  FlowHooksOf,
  type EventCheckResult,
  type EventContext,
  type EventSubscriptionRef,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { EventResourceExhaustedError, InvalidEventPublishError, type EventErrorCodes } from '../../errors';
import { callerPlatformOf, EVENT_DIALECTS, resolveEventDialect } from '../event-dialect';
import {
  assertEventAuthorities,
  assertEventAuthorizes,
  eventReaderOf,
  offeredEventOf,
  parsedEventArguments,
  readerSubscriptionOf,
  type EventReader,
} from '../event-gates';
import { newEventId } from '../event-publisher';
import type EventRegistry from '../event.registry';
import { type BufferedEvent, type EventBuffer } from '../poll/event-buffer';
import { pollLeaseMs, type EventPollLeases } from '../poll/event-poll-leases';
import { isInAudience } from './event-publish.flow';

const inputSchema = z.object({
  request: PollEventsRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = PollEventsResultSchema;

const stateSchema = z.object({
  authInfo: z.any() as z.ZodType<Partial<AuthInfo>>,
  dialect: z.enum(['sep-3415', 'sketch']),
  event: z.instanceof(EventEntry),
  reader: z.any() as z.ZodType<EventReader>,
  arguments: z.record(z.string(), z.unknown()),
  context: z.any() as z.ZodType<EventContext>,
  subscription: z.any() as z.ZodType<EventSubscriptionRef>,
  result: z.any() as z.ZodType<PollEventsResult>,
});

const plan = {
  pre: [
    'parseInput',
    'resolveDialect',
    'findEvent',
    'resolveReader',
    'checkEntryAuthorities',
    'validateArguments',
    'authorize',
  ],
  execute: ['renewLease', 'readEvents'],
  post: ['buildResult'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:poll': FlowRunOptions<
      EventPollFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'events:poll' as const;
const { Stage } = FlowHooksOf<'events:poll'>(name);

/** `events/poll`: the occurrences of one event since a cursor, for the caller and its arguments. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class EventPollFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('EventPollFlow');

  /** The event registry of a scope that performs the poll mode. */
  private get events(): EventRegistry {
    return this.scope.events as EventRegistry;
  }

  /** The JSON-RPC codes of the caller's dialect. */
  private get codes(): EventErrorCodes {
    return EVENT_DIALECTS[this.state.required.dialect].errorCodes;
  }

  /** Read the caller's auth from the request context. */
  @Stage('parseInput')
  async parseInput() {
    const authInfo = (this.input.ctx as { authInfo?: Partial<AuthInfo> } | undefined)?.authInfo ?? {};
    this.state.set('authInfo', authInfo);
  }

  /** Pick the dialect a refusal is answered in. */
  @Stage('resolveDialect')
  async resolveDialect() {
    const platform = callerPlatformOf(this.scope, this.state.required.authInfo, this.tryGetContext()?.platformType);
    this.state.set('dialect', resolveEventDialect(this.events.config.compat, platform));
  }

  /** Find the event, offered to the caller's surface in the poll mode. */
  @Stage('findEvent')
  async findEvent() {
    const eventName = this.input.request.params.name;
    this.state.set('event', offeredEventOf(this.events, eventName, 'poll', this.input.ctx, this.codes));
  }

  /** Name the reader: a signed-in caller, or the anonymous callers of a public server together. */
  @Stage('resolveReader')
  async resolveReader() {
    const { authInfo, event } = this.state.required;
    this.state.set('reader', eventReaderOf(this.scope, authInfo, event.name, this.codes));
  }

  /** Evaluate the event's `authorities` with the request's arguments as input, on every poll. */
  @Stage('checkEntryAuthorities')
  async checkEntryAuthorities() {
    const { event, authInfo } = this.state.required;
    const sentArguments = this.input.request.params.arguments ?? {};
    await assertEventAuthorities(this.scope, event, authInfo, sentArguments, this.codes);
  }

  /** Parse the arguments with the event's input schema, and name the subscription this poll stands for. */
  @Stage('validateArguments')
  async validateArguments() {
    const { event, reader } = this.state.required;
    const parsedArguments = parsedEventArguments(event, this.input.request.params.arguments);
    this.state.set({
      arguments: parsedArguments,
      subscription: readerSubscriptionOf(reader, 'poll', event.name, parsedArguments),
    });
  }

  /** Run the event's own `authorize()` on the context its other methods run on. */
  @Stage('authorize')
  async authorize() {
    const { event, authInfo, reader } = this.state.required;
    const context = event.create(authInfo);
    await assertEventAuthorizes(context, event.name, this.state.required.arguments, reader.subscriber, this.codes);
    this.state.set('context', context);
  }

  /** Keep the poll subscription alive for an event with lifecycle methods: its first poll calls `onSubscribe`. */
  @Stage('renewLease')
  async renewLease() {
    await this.renewLeaseFor(this.events.config.poll.nextPollMs);
  }

  /** Read from the event's `check()` when it has one, else from the buffer of published occurrences. */
  @Stage('readEvents')
  async readEvents() {
    const { context } = this.state.required;
    const result = context.check ? await this.readFromCheck() : await this.readFromBuffer();
    this.state.set('result', result);
    if (result.nextPollMs !== undefined && result.nextPollMs > this.events.config.poll.nextPollMs) {
      await this.renewLeaseFor(result.nextPollMs);
    }
  }

  /** Answer with the occurrences, the cursor to poll from next, and when to poll again. */
  @Stage('buildResult')
  async buildResult() {
    this.respond(this.state.required.result);
  }

  /** The most occurrences this poll returns: the request's `maxEvents`, within the server's. */
  private get limit(): number {
    const serverLimit = this.events.config.poll.maxEvents;
    return Math.min(this.input.request.params.maxEvents ?? serverLimit, serverLimit);
  }

  /** The oldest time this poll replays from, when the request bounds it and names a cursor. */
  private replayFloor(now: number): number | undefined {
    const { cursor, maxAgeMs } = this.input.request.params;
    const hasCursor = cursor !== undefined && cursor !== null;
    return hasCursor && maxAgeMs !== undefined ? now - maxAgeMs : undefined;
  }

  /** Start or renew the lease of this poll's subscription, within the limit of leases a caller may hold. */
  private async renewLeaseFor(nextPollMs: number): Promise<void> {
    const leases = this.events.pollLeases as EventPollLeases;
    const { context, subscription, reader } = this.state.required;
    if (!context.onSubscribe && !context.onUnsubscribe) return;
    if (!leases.has(subscription.id) && leases.isFull(reader.principalKey)) {
      const { maxPerPrincipal } = this.events.config.subscriptions;
      throw new EventResourceExhaustedError(this.codes, 'subscriptions', maxPerPrincipal);
    }
    await leases.renew({
      subscription,
      arguments: this.state.required.arguments,
      principalKey: reader.principalKey,
      leaseMs: pollLeaseMs(nextPollMs),
      context,
    });
  }

  /** Ask the event's `check()` for what happened since the cursor, and shape its answer as occurrences. */
  private async readFromCheck(): Promise<PollEventsResult> {
    const { context, event } = this.state.required;
    const { cursor = null, maxAgeMs } = this.input.request.params;
    const now = Date.now();
    const floor = this.replayFloor(now);
    const limits = { maxEvents: this.limit, ...(floor !== undefined && { maxAgeMs }) };
    const check = context.check as NonNullable<EventContext['check']>;
    const checked: EventCheckResult<Record<string, unknown>> = await check.call(
      context,
      this.state.required.arguments,
      cursor,
      limits,
    );

    const events: EventOccurrence[] = [];
    let skippedOldEvents = false;
    for (const item of checked.events) {
      const timestamp = item.timestamp ?? new Date(now).toISOString();
      if (floor !== undefined && Date.parse(timestamp) < floor) {
        skippedOldEvents = true;
        continue;
      }
      events.push({
        eventId: item.eventId ?? newEventId(),
        name: event.name,
        timestamp,
        data: this.checkedPayload(item.data),
      });
    }
    return {
      events,
      cursor: checked.cursor,
      truncated: checked.truncated === true || skippedOldEvents,
      hasMore: checked.hasMore === true,
      nextPollMs: checked.nextPollMs ?? this.events.config.poll.nextPollMs,
    };
  }

  /** The `data` a `check()` returned, validated against the payload schema: a mismatch is the event's mistake. */
  private checkedPayload(data: unknown): Record<string, unknown> {
    const { event } = this.state.required;
    try {
      return event.parsePayload(data);
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      throw new InvalidEventPublishError(
        event.name,
        `check() returned data that does not match payloadSchema: ${problem}`,
      );
    }
  }

  /** Read the published occurrences after the cursor that this reader may receive, up to the limit. */
  private async readFromBuffer(): Promise<PollEventsResult> {
    const buffer = this.events.buffer as EventBuffer;
    const { cursor } = this.input.request.params;
    const nextPollMs = this.events.config.poll.nextPollMs;
    if (cursor === undefined || cursor === null) {
      return { events: [], cursor: buffer.currentCursor(), truncated: false, hasMore: false, nextPollMs };
    }

    const read = buffer.read(this.state.required.event.name, cursor);
    const endCursor = buffer.currentCursor();
    const floor = this.replayFloor(Date.now());
    const events: EventOccurrence[] = [];
    let truncated = read.truncated;
    let lastExamined: BufferedEvent | undefined;
    for (const buffered of read.events) {
      if (floor !== undefined && buffered.publishedAt < floor) {
        truncated = true;
        lastExamined = buffered;
        continue;
      }
      const occurrence = await this.occurrenceFor(buffered);
      if (occurrence && events.length === this.limit) {
        const resumeCursor = lastExamined ? buffer.cursorAt(lastExamined.sequence) : cursor;
        return { events, cursor: resumeCursor, truncated, hasMore: true, nextPollMs };
      }
      if (occurrence) events.push(occurrence);
      lastExamined = buffered;
    }
    return { events, cursor: endCursor, truncated, hasMore: false, nextPollMs };
  }

  /** A buffered occurrence as this reader receives it; undefined when it is not for this reader. */
  private async occurrenceFor(buffered: BufferedEvent): Promise<EventOccurrence | undefined> {
    const { context, reader, subscription } = this.state.required;
    const { occurrence } = buffered;
    if (buffered.subscriptionId !== undefined && buffered.subscriptionId !== subscription.id) return undefined;
    if (!isInAudience(buffered.audience, reader.subscriber)) return undefined;
    const subscriptionArguments = this.state.required.arguments;
    try {
      const matches = (await context.match?.(occurrence, subscriptionArguments, reader.subscriber)) ?? true;
      if (!matches) return undefined;
      if (!context.transform) return occurrence;
      const transformed = await context.transform(occurrence, subscriptionArguments, reader.subscriber);
      return EventOccurrenceSchema.parse(transformed);
    } catch (error) {
      this.logger.warn(`readEvents: event "${occurrence.name}" failed for poll subscription ${subscription.id}`, error);
      return undefined;
    }
  }
}
