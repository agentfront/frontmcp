import { type Token } from '@frontmcp/di';
import {
  EVENT_DELIVERY_MODES,
  EVENTS_EXTENSION_ID,
  type EventDeliveryMode,
  type EventsExtensionSettings,
} from '@frontmcp/protocol';
import { getRuntimeContext, isEntryAvailable, type RootStorage } from '@frontmcp/utils';

import {
  FrontMcpLogger,
  type EntryOwnerRef,
  type EventEntry,
  type EventPublisher,
  type EventRecord,
  type EventType,
} from '../common';
import { type EventsConfig } from '../common/metadata/event.metadata';
import { EventNameConflictError } from '../errors';
import type ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, type RegistryBuildMapResult } from '../regsitry';
import { type EventMetrics } from './delivery/event-metrics';
import { type EventOutbox } from './delivery/event-outbox';
import { EventInstance } from './event.instance';
import { normalizeEvent } from './event.utils';
import { type EventBuffer } from './poll/event-buffer';
import { type EventPollLeases } from './poll/event-poll-leases';
import { type EventPublishEndpoint } from './publish-endpoint/event-publish-endpoint';
import { type EventReplays } from './replay/event-replays';
import { type EventStreams } from './stream/event-streams';
import { type EventSubscriptions } from './subscription/event-subscriptions';

export interface EventRegistryInterface {
  getEvents(): EventEntry[];
  hasAny(): boolean;
}

/** The events capability in both places clients read it: top-level (the design sketch) and as the SEP-3415 extension. */
export type EventCapabilities = {
  events?: EventsExtensionSettings;
  extensions?: Record<string, EventsExtensionSettings>;
};

/** An event with the delivery modes it is offered in. */
export interface ServedEvent {
  event: EventEntry;
  delivery: EventDeliveryMode[];
}

export default class EventRegistry
  extends RegistryAbstract<EventInstance, EventRecord, EventType[]>
  implements EventRegistryInterface
{
  owner: EntryOwnerRef;

  /** The server's `events` configuration, with its defaults applied. */
  readonly config: EventsConfig;

  /** The stored subscriptions, on a server that delivers by webhook. */
  subscriptions?: EventSubscriptions;

  /** Publishes the server's events; set once the registry is ready. */
  publisher?: EventPublisher;

  /** The pending deliveries, on a server that delivers by webhook. */
  outbox?: EventOutbox;

  /** Counts what happens to published events; set once the registry is ready. */
  metrics?: EventMetrics;

  /** The storage of the server's event records, once a part that keeps some opened it. */
  storage?: RootStorage;

  /** The HTTP publish endpoint, on a server that serves one (`events.publishEndpoint.enabled`). */
  publishEndpoint?: EventPublishEndpoint;

  /** The recent occurrences `events/poll` reads, on a server that performs the poll mode. */
  buffer?: EventBuffer;

  /** The leases of poll subscriptions, on a server that performs the poll mode. */
  pollLeases?: EventPollLeases;

  /** The open `events/stream` requests, on a server that performs the push mode. */
  streams?: EventStreams;

  /** The loops that feed the webhook subscriptions of events with `check()`, on a server that delivers by webhook. */
  replays?: EventReplays;

  /** Events that are not offered by webhook here: their `check()` needs a loop this runtime cannot run. */
  private readonly withoutWebhook = new Set<string>();

  private readonly eventsByName = new Map<string, EventInstance>();
  private readonly enabledDeliveryModes = new Set<EventDeliveryMode>();
  private readonly logger: FrontMcpLogger;

  /** The provider registry of each event declared on an app (its app's); other events use the registry's. */
  private readonly entryProviders: ReadonlyMap<Token, ProviderRegistry>;

  constructor(
    providers: ProviderRegistry,
    list: EventType[],
    owner: EntryOwnerRef,
    config: EventsConfig,
    entryProviders: ReadonlyMap<Token, ProviderRegistry>,
  ) {
    super('EventRegistry', providers, list, false);
    this.owner = owner;
    this.config = config;
    this.entryProviders = entryProviders;
    this.logger = providers.get(FrontMcpLogger).child('EventRegistry');
    this.buildGraph();
    this.ready = this.initialize();
  }

  /** Turns the listed events into records keyed by their token. */
  protected override buildMap(list: EventType[]): RegistryBuildMapResult<EventRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, EventRecord>();
    const graph = new Map<Token, Set<Token>>();
    for (const item of list) {
      const record = normalizeEvent(item);
      tokens.add(record.provide);
      defs.set(record.provide, record);
      graph.set(record.provide, new Set());
    }
    return { tokens, defs, graph };
  }

  protected buildGraph(): void {}

  /** Creates an instance per available event and refuses a name declared twice. */
  protected override async initialize(): Promise<void> {
    const runtimeContext = getRuntimeContext();
    for (const [token, record] of this.defs) {
      const eventName = record.metadata.name;
      // `availableWhen` is process-wide: an event unavailable here is not registered, so its name stays free
      if (!isEntryAvailable(record.metadata.availableWhen, runtimeContext)) {
        this.logger.verbose(`Event "${eventName}" is not available in this runtime; skipped`);
        continue;
      }
      if (this.eventsByName.has(eventName)) {
        throw new EventNameConflictError(eventName);
      }
      const instance = new EventInstance(record, this.entryProviders.get(token) ?? this.providers, this.owner);
      await instance.ready;
      this.instances.set(token as Token<EventInstance>, instance);
      this.eventsByName.set(eventName, instance);
    }
  }

  /** Every registered event, whether or not a delivery mode serves it. */
  getEvents(): EventInstance[] {
    return [...this.eventsByName.values()];
  }

  /** The event registered under a name. */
  findByName(name: string): EventInstance | undefined {
    return this.eventsByName.get(name);
  }

  /** Whether any event is registered. */
  hasAny(): boolean {
    return this.eventsByName.size > 0;
  }

  /** Record that this server can deliver events in `mode`. The part that implements a mode calls it at startup. */
  enableDeliveryMode(mode: EventDeliveryMode): void {
    this.enabledDeliveryModes.add(mode);
  }

  /** Keep an event off the webhook mode: it is still offered in the other modes the server performs. */
  withholdWebhookFrom(eventName: string): void {
    this.withoutWebhook.add(eventName);
  }

  /** Whether this server delivers events in `mode`. */
  performs(mode: EventDeliveryMode): boolean {
    return this.enabledDeliveryModes.has(mode);
  }

  /** The modes an event is offered in: those the server can perform, within the event's own `delivery`. */
  deliveryModesOf(event: EventEntry): EventDeliveryMode[] {
    const restriction = event.metadata.delivery;
    return EVENT_DELIVERY_MODES.filter(
      (mode) =>
        this.enabledDeliveryModes.has(mode) &&
        (!restriction || restriction.includes(mode)) &&
        !(mode === 'webhook' && this.withoutWebhook.has(event.name)),
    );
  }

  /** The events a client can subscribe to: those offered in at least one delivery mode. */
  getServedEvents(): ServedEvent[] {
    return this.getEvents()
      .map((event) => ({ event, delivery: this.deliveryModesOf(event) }))
      .filter(({ delivery }) => delivery.length > 0);
  }

  /** Whether a client can subscribe to at least one event. */
  servesEvents(): boolean {
    return this.getServedEvents().length > 0;
  }

  /** The capability to advertise: both forms once an event is served, nothing otherwise. */
  getCapabilities(): EventCapabilities {
    if (!this.servesEvents()) return {};
    return { events: {}, extensions: { [EVENTS_EXTENSION_ID]: {} } };
  }
}
