import type { ResourceEntry } from '../../common/entries/resource.entry';
import type { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import {
  isProducedResourceKey,
  isResourceKey,
  isResourceKeyFamily,
  type ResourceKey,
  type ResourceStoreHandle,
} from '../../common/metadata/materialized.metadata';
import type { ResourceMetadata } from '../../common/metadata/resource.metadata';
import { InvalidResourceStoreError } from '../../errors/mcp.error';
import type { ResourceChangeEvent } from '../resource.events';
import { MaterializedResourceContext, missingKeyMessage } from './materialized-resource.context';

/** What the materialized resources need from their scope. */
export interface MaterializedResourcesScope {
  readonly resources: {
    listAllInstances(): readonly ResourceEntry[];
    subscribe(options: { immediate?: boolean }, listener: (event: ResourceChangeEvent) => void): () => void;
    notifyContentChanged(uri: string): void;
    watchedUris(): string[];
    onWatchChange(listener: () => void): () => void;
  };
  readonly logger: Pick<FrontMcpLogger, 'warn'>;
}

interface FollowedKey {
  readonly key: ResourceKey;
  readonly unfollow: () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function servesWithoutKey(entry: ResourceEntry): boolean {
  const provide: unknown = entry.record.provide;
  const servesStoredValue = typeof provide === 'function' && provide.prototype instanceof MaterializedResourceContext;
  return servesStoredValue && !(entry.metadata as ResourceMetadata).from;
}

function storeOf(entry: ResourceEntry): ResourceStoreHandle | undefined {
  const from: unknown = (entry.metadata as { from?: unknown }).from;
  return isResourceKey(from) || isResourceKeyFamily(from) ? from.store : undefined;
}

function sameKey(one: ResourceKey, other: ResourceKey): boolean {
  return one === other || (one.store === other.store && one.name === other.name);
}

/**
 * The scope's materialized resources (`@Resource({ from })`, `@ResourceTemplate({ from })`): a key's revision change,
 * from a write in any process, becomes the registry's content change, which reaches the sessions subscribed to its URI
 * and the 2026-07-28 `subscriptions/listen` streams. A written key is followed from start to stop. A producer-backed
 * key, and a template's key, is followed only while its URI has a subscriber, so a producer runs only then. It opens
 * the stores at start and closes them at stop.
 */
export class MaterializedResources {
  private readonly followed = new Map<string, FollowedKey>();
  private readonly connected = new Set<ResourceStoreHandle>();
  private readonly stopListening: Array<() => void> = [];

  constructor(private readonly scope: MaterializedResourcesScope) {}

  async start(): Promise<void> {
    const entries = this.scope.resources.listAllInstances();
    const misdeclared = entries.find(servesWithoutKey);
    if (misdeclared) throw new InvalidResourceStoreError(missingKeyMessage(misdeclared.metadata.name));
    const stores = new Set(entries.flatMap((entry) => storeOf(entry) ?? []));
    const opened = await Promise.allSettled([...stores].map((store) => this.connect(store)));
    const failure = opened.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) {
      await this.stop().catch((error: unknown) =>
        this.scope.logger.warn(`A materialized resource store did not close after a failed start: ${messageOf(error)}`),
      );
      throw failure.reason;
    }
    this.refresh();
    this.stopListening.push(
      this.scope.resources.subscribe({ immediate: false }, (event) => {
        if (event.kind !== 'updated') this.refresh();
      }),
      this.scope.resources.onWatchChange(() => this.refresh()),
    );
  }

  async stop(): Promise<void> {
    for (const stopListening of this.stopListening.splice(0)) stopListening();
    for (const { unfollow } of this.followed.values()) unfollow();
    this.followed.clear();
    const stores = [...this.connected];
    this.connected.clear();
    await Promise.all(stores.map((store) => store.close()));
  }

  private connect(store: ResourceStoreHandle): Promise<void> {
    this.connected.add(store);
    return store.connect();
  }

  /** The key each URI should follow now: every written key, and the others whose URI has a subscriber. */
  private wanted(): Map<string, ResourceKey> {
    const wanted = new Map<string, ResourceKey>();
    const watched = this.scope.resources.watchedUris();
    const entries = this.scope.resources.listAllInstances();
    for (const entry of entries) {
      const from = (entry.metadata as ResourceMetadata).from;
      if (entry.isTemplate || !entry.uri || !isResourceKey(from)) continue;
      const uri = entry.uri;
      if (!isProducedResourceKey(from) || watched.some((prefix) => uri.startsWith(prefix))) wanted.set(uri, from);
    }
    for (const entry of entries) {
      const from: unknown = (entry.metadata as { from?: unknown }).from;
      if (!entry.isTemplate || !isResourceKeyFamily(from)) continue;
      for (const uri of watched) {
        if (wanted.has(uri)) continue;
        const { matches, params } = entry.matchUri(uri);
        if (matches) wanted.set(uri, from.key(params));
      }
    }
    return wanted;
  }

  private refresh(): void {
    const wanted = this.wanted();
    for (const [uri, { key, unfollow }] of this.followed) {
      const next = wanted.get(uri);
      if (next && sameKey(next, key)) continue;
      unfollow();
      this.followed.delete(uri);
    }
    for (const [uri, key] of wanted) {
      if (this.followed.has(uri)) continue;
      if (!this.connected.has(key.store)) {
        this.connect(key.store).catch((error: unknown) =>
          this.scope.logger.warn(`The store of materialized resource ${uri} could not open: ${messageOf(error)}`),
        );
      }
      this.followed.set(uri, { key, unfollow: key.subscribe(() => this.scope.resources.notifyContentChanged(uri)) });
    }
  }
}
