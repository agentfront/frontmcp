import { internalZ as z } from '@frontmcp/lazy-zod';
import { StreamEventsRequestSchema, type AuthInfo } from '@frontmcp/protocol';

import {
  EventEntry,
  Flow,
  FlowBase,
  FlowHooksOf,
  type EventContext,
  type EventSubscriptionRef,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { EventResourceExhaustedError, type EventErrorCodes } from '../../errors';
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
import type EventRegistry from '../event.registry';
import { EventStream } from '../stream/event-stream';
import { type EventStreams } from '../stream/event-streams';

const inputSchema = z.object({
  request: StreamEventsRequestSchema,
  ctx: z.unknown(),
  /** The JSON-RPC id of the request: the subscription id of every notification of the stream. */
  requestId: z.union([z.string(), z.number()]),
  /** Aborted when the client cancels the request or disconnects. */
  signal: z.any().optional() as z.ZodType<AbortSignal | undefined>,
});

const outputSchema = z.object({
  stream: z.instanceof(EventStream),
});

const stateSchema = z.object({
  authInfo: z.any() as z.ZodType<Partial<AuthInfo>>,
  dialect: z.enum(['sep-3415', 'sketch']),
  event: z.instanceof(EventEntry),
  reader: z.any() as z.ZodType<EventReader>,
  arguments: z.record(z.string(), z.unknown()),
  context: z.any() as z.ZodType<EventContext>,
  subscription: z.any() as z.ZodType<EventSubscriptionRef>,
  stream: z.instanceof(EventStream),
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
  execute: ['openStream'],
  post: ['buildResult'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:stream': FlowRunOptions<
      EventStreamFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'events:stream' as const;
const { Stage } = FlowHooksOf<'events:stream'>(name);

/** `events/stream`: open the stream one subscription is pushed on, for as long as its request lives. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class EventStreamFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('EventStreamFlow');

  /** The event registry of a scope that performs the push mode. */
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

  /** Find the event, offered to the caller's surface in the push mode. */
  @Stage('findEvent')
  async findEvent() {
    const eventName = this.input.request.params.name;
    this.state.set('event', offeredEventOf(this.events, eventName, 'push', this.input.ctx, this.codes));
  }

  /** Name the reader: a signed-in caller, or an anonymous caller of a public server. */
  @Stage('resolveReader')
  async resolveReader() {
    const { authInfo, event } = this.state.required;
    this.state.set('reader', eventReaderOf(this.scope, authInfo, event.name, this.codes));
  }

  /** Evaluate the event's `authorities` with the request's arguments as input. */
  @Stage('checkEntryAuthorities')
  async checkEntryAuthorities() {
    const { event, authInfo } = this.state.required;
    const sentArguments = this.input.request.params.arguments ?? {};
    await assertEventAuthorities(this.scope, event, authInfo, sentArguments, this.codes);
  }

  /** Parse the arguments with the event's input schema, and name the subscription this stream stands for. */
  @Stage('validateArguments')
  async validateArguments() {
    const { event, reader } = this.state.required;
    const parsedArguments = parsedEventArguments(event, this.input.request.params.arguments);
    this.state.set({
      arguments: parsedArguments,
      subscription: readerSubscriptionOf(reader, 'push', event.name, parsedArguments),
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

  /** Open the stream within the caller's limit: `onSubscribe` first, `onUnsubscribe(..., 'closed')` when it ends. */
  @Stage('openStream')
  async openStream() {
    const streams = this.events.streams as EventStreams;
    const { event, context, reader, subscription, authInfo } = this.state.required;
    const { config } = this.events;
    if (streams.isFull(reader.principalKey)) {
      throw new EventResourceExhaustedError(this.codes, 'subscriptions', config.subscriptions.maxPerPrincipal);
    }

    const subscriptionArguments = this.state.required.arguments;
    const codes = this.codes;
    const stream = new EventStream({
      requestId: this.input.requestId,
      event,
      context,
      reader,
      subscription,
      arguments: subscriptionArguments,
      cursor: this.input.request.params.cursor,
      maxAgeMs: this.input.request.params.maxAgeMs,
      buffer: context.check ? undefined : this.events.buffer,
      heartbeatMs: config.push.heartbeatMs,
      checkIntervalMs: config.poll.nextPollMs,
      checkMaxEvents: config.poll.maxEvents,
      reauthorizeEveryMs: config.subscriptions.reauthorizeEveryMs,
      isStillAuthorized: () =>
        assertEventAuthorities(this.scope, event, authInfo, subscriptionArguments, codes).then(
          () => true,
          () => false,
        ),
      accessRevoked: { code: codes.forbidden, message: 'Forbidden', data: { reason: 'Access revoked' } },
      signal: this.input.signal,
      logger: this.logger,
    });

    await context.onSubscribe?.(subscriptionArguments, subscription);
    stream.onClose(() => {
      Promise.resolve(context.onUnsubscribe?.(subscriptionArguments, subscription, 'closed')).catch((error: unknown) =>
        this.logger.warn(`onUnsubscribe of event "${event.name}" failed for stream ${subscription.id}`, error),
      );
    });
    streams.add(stream);
    await stream.open();
    this.state.set('stream', stream);
    this.logger.verbose(`openStream: stream ${subscription.id} opened for event "${event.name}"`);
  }

  /** Answer with the open stream: the transport sends its notifications, then the final frame. */
  @Stage('buildResult')
  async buildResult() {
    this.respond({ stream: this.state.required.stream });
  }
}
