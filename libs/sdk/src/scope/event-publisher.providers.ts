import {
  EventPublisher,
  ProviderScope,
  type EventPublishOptions,
  type EventPublishResult,
  type EventReference,
  type ScopeEntry,
} from '../common';
import { EVENT_PUBLISHER } from '../common/tokens/event.tokens';
import { EventsNotEnabledError } from '../errors';

/** The publisher providers are built with, before the scope registers its events: it publishes through the scope's own. */
export class DeferredEventPublisher extends EventPublisher {
  /** Takes the scope whose event registry it reads at each publish. */
  constructor(private readonly scope: Pick<ScopeEntry, 'events'>) {
    super();
  }

  /** Publish through the scope's publisher; on a server without events, refuse as `this.events` does. */
  publish(
    event: string | EventReference<unknown>,
    data: unknown,
    options?: EventPublishOptions,
  ): Promise<EventPublishResult> {
    const publisher = this.scope.events?.publisher;
    if (!publisher) return Promise.reject(new EventsNotEnabledError());
    return publisher.publish(event as EventReference<unknown>, data, options);
  }
}

/** The providers that give a scope's publisher to what is built with it, by its class and by `EVENT_PUBLISHER`. */
export function eventPublisherProviders(scope: Pick<ScopeEntry, 'events'>) {
  const publisher = new DeferredEventPublisher(scope);
  return [
    { scope: ProviderScope.GLOBAL, name: 'EventPublisher', provide: EventPublisher, useValue: publisher },
    { scope: ProviderScope.GLOBAL, name: 'EVENT_PUBLISHER', provide: EVENT_PUBLISHER, useValue: publisher },
  ];
}
