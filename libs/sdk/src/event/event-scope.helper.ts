import { isPublicMode } from '@frontmcp/auth';
import { type Token } from '@frontmcp/di';
import { getRuntimeContext, sha256Hex, type NamespacedStorage } from '@frontmcp/utils';

import {
  ProviderScope,
  type EntryOwnerRef,
  type EventEntry,
  type EventType,
  type FrontMcpLogger,
  type ScopeEntry,
} from '../common';
import { eventsConfigSchema, type EventsConfig, type EventsConfigOptions } from '../common/metadata/event.metadata';
import { EVENT_PUBLISHER } from '../common/tokens/event.tokens';
import { type HealthProbeResult } from '../common/types/options/health';
import { isLongLivedProcess } from '../duty/lease-store';
import { assertEntryAuthorities, type EntryAuthorities } from '../front-mcp/authorities-rules.check';
import type ProviderRegistry from '../provider/provider.registry';
import { createEventMetrics } from './delivery/event-metrics';
import { EventOutbox } from './delivery/event-outbox';
import { ScopeEventPublisher } from './event-publisher';
import { reauthorizeSubscriber } from './event-reauthorization';
import EventRegistry from './event.registry';
import EventDeliverFlow from './flows/event-deliver.flow';
import EventPollFlow from './flows/event-poll.flow';
import EventPublishFlow, { EVENT_DELIVERY_MAX_BYTES } from './flows/event-publish.flow';
import EventStreamFlow from './flows/event-stream.flow';
import EventSubscribeFlow from './flows/event-subscribe.flow';
import EventUnsubscribeFlow from './flows/event-unsubscribe.flow';
import ListEventsFlow from './flows/list-events.flow';
import { EventBuffer } from './poll/event-buffer';
import { EventPollLeases } from './poll/event-poll-leases';
import { enablePublishEndpoint } from './publish-endpoint/event-publish-endpoint';
import { EventReplays } from './replay/event-replays';
import { EventStreams } from './stream/event-streams';
import { EventCallbackVerifier } from './subscription/event-callback-verifier';
import { createEventSubscriptionStore } from './subscription/event-subscription-store.factory';
import { accessRevokedError, terminateEventSubscription } from './subscription/event-subscription-termination';
import { EventSubscriptions } from './subscription/event-subscriptions';

export interface RegisterEventCapabilitiesArgs {
  providers: ProviderRegistry;
  owner: EntryOwnerRef;
  eventsList: EventType[];
  /** The provider registry of each event declared on an app, by its token. */
  eventProviders: ReadonlyMap<Token, ProviderRegistry>;
  /** `@FrontMcp({ events })`. */
  eventsConfig?: EventsConfigOptions;
  logger: FrontMcpLogger;
}

export interface EventCapabilitiesResult {
  eventRegistry: EventRegistry;
}

/** The events that declare an `authorities` rule, labelled for the startup check. */
function eventsWithAuthorities(events: readonly EventEntry[]): EntryAuthorities[] {
  const guarded: EntryAuthorities[] = [];
  for (const event of events) {
    const authorities = event.getAuthorities();
    if (authorities !== undefined) guarded.push({ label: `Event "${event.name}"`, authorities });
  }
  return guarded;
}

/** Refuse to start with an event whose `authorities` nothing enforces, or whose rule is malformed. */
function assertEventAuthorities(scope: ScopeEntry, events: readonly EventEntry[]): void {
  const guarded = eventsWithAuthorities(events);
  if (guarded.length === 0) return;
  assertEntryAuthorities(scope.authoritiesEngine, scope.authoritiesContextBuilder, guarded);
}

/** Whether the server's auth names its callers: a subscription needs an owner, which public mode cannot give. */
function canIdentifyCallers(scope: ScopeEntry): boolean {
  const authOptions = scope.auth?.options;
  return authOptions !== undefined && !isPublicMode(authOptions);
}

/** The key prefix of the server's subscriptions: its own, so servers that share a store never see each other's. */
function storeKeyPrefixOf(scope: ScopeEntry, eventsConfig: EventsConfig): string {
  const configuredPrefix = eventsConfig.store?.keyPrefix;
  if (configuredPrefix) return configuredPrefix;
  return `mcp:events:${sha256Hex(`server:${scope.metadata.info.name}`).slice(0, 16)}:`;
}

/** The readiness of the outbox: healthy with its depth while its storage answers. */
async function outboxHealth(outbox: EventOutbox): Promise<HealthProbeResult> {
  try {
    return { status: 'healthy', details: { pendingDeliveries: await outbox.depth() } };
  } catch (error) {
    return { status: 'unhealthy', error: error instanceof Error ? error.message : String(error) };
  }
}

/** Run the webhook loops of the events with `check()`, or keep them off webhook where no loop can run. */
async function startReplays(
  eventRegistry: EventRegistry,
  replays: EventReplays,
  logger: FrontMcpLogger,
): Promise<void> {
  const replayable = eventRegistry.getEvents().filter((event) => replays.isReplayable(event));
  if (replayable.length === 0) return;
  if (isLongLivedProcess()) {
    eventRegistry.replays = replays;
    await replays.start(replayable);
    return;
  }
  for (const event of replayable) eventRegistry.withholdWebhookFrom(event.name);
  logger.warn(
    `${replayable.length} event(s) with check() are not offered by webhook here: delivering them needs a ` +
      'long-lived process, which a serverless, edge or browser runtime is not. They are offered by poll.',
  );
}

/** Open the subscription store and the outbox, start their sweeps, and serve subscriptions and deliveries. */
async function enableWebhookDelivery(
  scope: ScopeEntry,
  eventRegistry: EventRegistry,
  eventsConfig: EventsConfig,
  logger: FrontMcpLogger,
): Promise<NamespacedStorage> {
  const { webhook, store: storeConfig } = eventsConfig;
  const { store, durable, storage, secret } = await createEventSubscriptionStore({
    redis: storeConfig?.redis,
    sqlite: storeConfig?.sqlite,
    keyPrefix: storeKeyPrefixOf(scope, eventsConfig),
    logger,
  });
  const verifier = new EventCallbackVerifier({
    allowedCallbacks: webhook.allowedCallbacks,
    allowLocal: webhook.unsafeAllowLocalCallbacks,
    cacheTtlMs: webhook.verification.cacheTtlMs,
    timeoutMs: webhook.verification.timeoutMs,
  });
  const subscriptions = new EventSubscriptions({
    events: eventRegistry,
    store,
    durable,
    verifier,
    settings: eventsConfig.subscriptions,
    rotationGraceMs: webhook.rotationGraceMs,
    logger,
  });
  const outbox = new EventOutbox({
    storage,
    secret,
    durable,
    settings: webhook.delivery,
    attempt: (delivery) => scope.runFlowForOutput('events:deliver', { delivery }),
    metrics: eventRegistry.metrics ?? createEventMetrics(undefined),
    logger,
  });
  eventRegistry.subscriptions = subscriptions;
  eventRegistry.outbox = outbox;
  eventRegistry.storage = storage;
  await scope.registryFlows(EventDeliverFlow);
  subscriptions.start();
  outbox.start();
  const replays = new EventReplays({
    store,
    outbox,
    storage,
    intervalMs: eventsConfig.poll.nextPollMs,
    maxEvents: eventsConfig.poll.maxEvents,
    maxBodyBytes: EVENT_DELIVERY_MAX_BYTES,
    reauthorizeEveryMs: eventsConfig.subscriptions.reauthorizeEveryMs,
    reauthorize: (event, record) =>
      reauthorizeSubscriber({ scope, event, subscriber: record.subscriber, arguments: record.arguments }),
    terminate: (record) =>
      terminateEventSubscription({
        subscriptions,
        outbox,
        metrics: eventRegistry.metrics,
        logger,
        subscription: record,
        error: accessRevokedError(record.dialect),
      }),
    logger,
  });
  await startReplays(eventRegistry, replays, logger);
  scope.onDispose(async () => {
    await replays.stop();
    await outbox.stop();
    await subscriptions.close();
  });
  scope.registerHealthProbe({ name: 'events-outbox', check: () => outboxHealth(outbox) });

  if (webhook.unsafeAllowLocalCallbacks) {
    logger.warn(
      'events.webhook.unsafeAllowLocalCallbacks is on: callbacks may be http and local. Use it in tests only.',
    );
  }
  eventRegistry.enableDeliveryMode('webhook');
  await scope.registryFlows(EventSubscribeFlow, EventUnsubscribeFlow);
  return storage;
}

/** Keep published occurrences for `events/poll`, start the poll leases and serve the method. */
async function enablePollDelivery(
  scope: ScopeEntry,
  eventRegistry: EventRegistry,
  eventsConfig: EventsConfig,
  logger: FrontMcpLogger,
): Promise<void> {
  const pollLeases = new EventPollLeases({ maxPerPrincipal: eventsConfig.subscriptions.maxPerPrincipal, logger });
  eventRegistry.pollLeases = pollLeases;
  pollLeases.start();
  scope.onDispose(() => pollLeases.stop());
  eventRegistry.enableDeliveryMode('poll');
  await scope.registryFlows(EventPollFlow);
}

/** Whether this process lives long enough to hold a stream open: a serverless function does not. */
function canHoldStreams(): boolean {
  return getRuntimeContext().deployment !== 'serverless';
}

/** Keep the open `events/stream` requests, relay occurrences between processes when the storage can, and serve the method. */
async function enableStreamDelivery(
  scope: ScopeEntry,
  eventRegistry: EventRegistry,
  buffer: EventBuffer,
  eventsConfig: EventsConfig,
  storage: NamespacedStorage | undefined,
  logger: FrontMcpLogger,
): Promise<void> {
  const streams = new EventStreams({
    buffer,
    maxPerPrincipal: eventsConfig.subscriptions.maxPerPrincipal,
    // Only redis carries pub/sub between processes; a memory or SQLite store's reaches this process alone
    storage: eventsConfig.store?.redis ? storage : undefined,
    logger,
  });
  eventRegistry.streams = streams;
  await streams.start();
  scope.onDispose(() => streams.stop());
  if (!streams.isRelayed) {
    logger.info(
      'Event streams carry what this process publishes. With several processes, set events.store.redis so an event ' +
        'published on one reaches the streams the others hold.',
    );
  }
  eventRegistry.enableDeliveryMode('push');
  await scope.registryFlows(EventStreamFlow);
}

/** Register the scope's events and their flows. Resolves to `undefined` with `events.enabled: false`. */
export async function registerEventCapabilities(
  args: RegisterEventCapabilitiesArgs,
): Promise<EventCapabilitiesResult | undefined> {
  const { providers, owner, eventsList, eventProviders, logger } = args;
  const eventsConfig = eventsConfigSchema.parse(args.eventsConfig ?? {});

  if (eventsConfig.enabled === false) {
    logger.warn(
      `Events are disabled (events.enabled: false), so the ${eventsList.length} event(s) apps declare are not served. ` +
        'Remove events.enabled: false to serve them.',
    );
    return undefined;
  }

  const scope = providers.getActiveScope();
  const eventRegistry = new EventRegistry(providers, eventsList, owner, eventsConfig, eventProviders);
  await eventRegistry.ready;
  assertEventAuthorities(scope, eventRegistry.getEvents());

  const publisher = new ScopeEventPublisher(scope, eventRegistry);
  eventRegistry.publisher = publisher;
  eventRegistry.metrics = createEventMetrics(scope.metadata.metrics);
  providers.injectProvider({
    provide: EVENT_PUBLISHER,
    value: publisher,
    metadata: {
      id: 'frontmcp-event-publisher',
      name: 'EventPublisher',
      scope: ProviderScope.GLOBAL,
      description: 'Publishes the events of the server to their subscribers.',
    },
  });

  await scope.registryFlows(ListEventsFlow, EventPublishFlow);

  let storage: NamespacedStorage | undefined;
  if (eventsConfig.webhook.enabled && canIdentifyCallers(scope)) {
    storage = await enableWebhookDelivery(scope, eventRegistry, eventsConfig, logger);
  } else if (eventsConfig.webhook.enabled) {
    logger.warn(
      'Webhook event delivery is off: the server runs in public auth mode, so a subscription would have no owner. ' +
        'Configure an auth mode that signs callers in to deliver events by webhook.',
    );
  }
  const pushes = eventsConfig.push.enabled && canHoldStreams();
  const buffer = eventsConfig.poll.enabled || pushes ? new EventBuffer(eventsConfig.buffer) : undefined;
  eventRegistry.buffer = buffer;
  if (eventsConfig.poll.enabled) await enablePollDelivery(scope, eventRegistry, eventsConfig, logger);
  if (buffer && pushes) await enableStreamDelivery(scope, eventRegistry, buffer, eventsConfig, storage, logger);

  if (eventsConfig.publishEndpoint.enabled) {
    await enablePublishEndpoint({
      scope,
      eventRegistry,
      identifiesCallers: canIdentifyCallers(scope),
      keyPrefix: storeKeyPrefixOf(scope, eventsConfig),
      logger,
    });
  }

  logger.info(`Event system initialized: ${eventRegistry.getEvents().length} event(s)`);
  return { eventRegistry };
}
