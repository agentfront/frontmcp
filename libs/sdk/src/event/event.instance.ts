import type { AuthInfo } from '@frontmcp/protocol';

import {
  EventContext,
  EventEntry,
  EventKind,
  FrontMcpLogger,
  type EntryOwnerRef,
  type EventCtorArgs,
  type EventRecord,
} from '../common';
import type ProviderRegistry from '../provider/provider.registry';

/** The context of an event declared with `event()`: its methods are the functions given to the builder. */
class FunctionEventContext extends EventContext {}

/** A registered event, bound to the providers of the app that declares it. */
export class EventInstance extends EventEntry {
  private readonly entryProviders: ProviderRegistry;

  constructor(record: EventRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.entryProviders = providers;
    this.name = record.metadata.name;
    this.fullName = `${owner.id}:${this.name}`;
    this.ready = this.initialize();
  }

  get providers(): ProviderRegistry {
    return this.entryProviders;
  }

  protected async initialize(): Promise<void> {}

  /** Builds the context the event's methods run on, for one caller. */
  create(authInfo: Partial<AuthInfo>): EventContext {
    const contextArgs: EventCtorArgs = {
      metadata: this.metadata,
      providers: this.entryProviders,
      logger: this.entryProviders.get(FrontMcpLogger),
      authInfo,
    };
    if (this.record.kind === EventKind.CLASS_TOKEN) {
      return new this.record.provide(contextArgs);
    }
    const context = new FunctionEventContext(contextArgs);
    return Object.assign(context, this.record.provide());
  }
}
