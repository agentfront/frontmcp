import { isPublicMode } from '@frontmcp/auth';
import { type Token } from '@frontmcp/di';
import { sha256Hex } from '@frontmcp/utils';

import { type EntryOwnerRef, type EventEntry, type EventType, type FrontMcpLogger, type ScopeEntry } from '../common';
import { eventsConfigSchema, type EventsConfig, type EventsConfigOptions } from '../common/metadata/event.metadata';
import { assertEntryAuthorities, type EntryAuthorities } from '../front-mcp/authorities-rules.check';
import type ProviderRegistry from '../provider/provider.registry';
import EventRegistry from './event.registry';
import EventSubscribeFlow from './flows/event-subscribe.flow';
import EventUnsubscribeFlow from './flows/event-unsubscribe.flow';
import ListEventsFlow from './flows/list-events.flow';
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

/** Open the subscription store, start the expiry sweep and serve `events/subscribe` and `events/unsubscribe`. */
async function enableWebhookDelivery(
  scope: ScopeEntry,
  eventRegistry: EventRegistry,
  eventsConfig: EventsConfig,
  logger: FrontMcpLogger,
): Promise<void> {
  const { webhook, store: storeConfig } = eventsConfig;
  const { store, durable } = await createEventSubscriptionStore({
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
  eventRegistry.subscriptions = subscriptions;
  subscriptions.start();
  scope.onDispose(() => subscriptions.close());

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

  await scope.registryFlows(ListEventsFlow);

  if (eventsConfig.webhook.enabled && canIdentifyCallers(scope)) {
    await enableWebhookDelivery(scope, eventRegistry, eventsConfig, logger);
  } else if (eventsConfig.webhook.enabled) {
    logger.warn(
      'Webhook event delivery is off: the server runs in public auth mode, so a subscription would have no owner. ' +
        'Configure an auth mode that signs callers in to serve events.',
    );
  }

  logger.info(`Event system initialized: ${eventRegistry.getEvents().length} event(s)`);
  return { eventRegistry };
}
