import { isPublicMode } from '@frontmcp/auth';
import { type Token } from '@frontmcp/di';
import { sha256Hex } from '@frontmcp/utils';

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
import { assertEntryAuthorities, type EntryAuthorities } from '../front-mcp/authorities-rules.check';
import type ProviderRegistry from '../provider/provider.registry';
import { createEventMetrics } from './delivery/event-metrics';
import { EventOutbox } from './delivery/event-outbox';
import { ScopeEventPublisher } from './event-publisher';
import EventRegistry from './event.registry';
import EventDeliverFlow from './flows/event-deliver.flow';
import EventPublishFlow from './flows/event-publish.flow';
import EventSubscribeFlow from './flows/event-subscribe.flow';
import EventUnsubscribeFlow from './flows/event-unsubscribe.flow';
import ListEventsFlow from './flows/list-events.flow';
import { enablePublishEndpoint } from './publish-endpoint/event-publish-endpoint';
import { EventCallbackVerifier } from './subscription/event-callback-verifier';
import { createEventSubscriptionStore } from './subscription/event-subscription-store.factory';
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

/** Open the subscription store and the outbox, start their sweeps, and serve subscriptions and deliveries. */
async function enableWebhookDelivery(
  scope: ScopeEntry,
  eventRegistry: EventRegistry,
  eventsConfig: EventsConfig,
  logger: FrontMcpLogger,
): Promise<void> {
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
  scope.onDispose(async () => {
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

  if (eventsConfig.webhook.enabled && canIdentifyCallers(scope)) {
    await enableWebhookDelivery(scope, eventRegistry, eventsConfig, logger);
  } else if (eventsConfig.webhook.enabled) {
    logger.warn(
      'Webhook event delivery is off: the server runs in public auth mode, so a subscription would have no owner. ' +
        'Configure an auth mode that signs callers in to serve events.',
    );
  }

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
