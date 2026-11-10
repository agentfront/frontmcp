import { type Token } from '@frontmcp/di';

import { type EntryOwnerRef, type EventEntry, type EventType, type FrontMcpLogger, type ScopeEntry } from '../common';
import { eventsConfigSchema, type EventsConfigOptions } from '../common/metadata/event.metadata';
import { assertEntryAuthorities, type EntryAuthorities } from '../front-mcp/authorities-rules.check';
import type ProviderRegistry from '../provider/provider.registry';
import EventRegistry from './event.registry';

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

/** Register the scope's events. Resolves to `undefined` with `events.enabled: false`. */
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

  logger.info(`Event system initialized: ${eventRegistry.getEvents().length} event(s)`);
  return { eventRegistry };
}
