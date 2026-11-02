import type { ResourceEntry } from '../../common/entries/resource.entry';
import type { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import type { ResourceKey, ResourceStoreHandle } from '../../common/metadata/materialized.metadata';
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
  };
  readonly logger: Pick<FrontMcpLogger, 'warn'>;
}

interface MaterializedEntry {
  readonly uri: string;
  readonly from: ResourceKey;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function servesWithoutKey(entry: ResourceEntry): boolean {
  const provide: unknown = entry.record.provide;
  const servesStoredValue = typeof provide === 'function' && provide.prototype instanceof MaterializedResourceContext;
  return servesStoredValue && !(entry.metadata as ResourceMetadata).from;
}

function materializedEntry(entry: ResourceEntry): MaterializedEntry | undefined {
  const from = (entry.metadata as ResourceMetadata).from;
  return !entry.isTemplate && entry.uri && from ? { uri: entry.uri, from } : undefined;
}

/**
 * The scope's materialized resources (`@Resource({ from })`): each one's key is followed, and a revision change, from
 * a write in any process, becomes the registry's content change, which reaches the sessions subscribed to its URI
 * and the 2026-07-28 `subscriptions/listen` streams. It opens the stores at start and closes them at stop.
 */
export class MaterializedResources {
  private readonly followed = new Map<ResourceEntry, () => void>();
  private readonly connected = new Set<ResourceStoreHandle>();
  private stopRegistry?: () => void;

  constructor(private readonly scope: MaterializedResourcesScope) {}

  async start(): Promise<void> {
    const entries = this.scope.resources.listAllInstances();
    const misdeclared = entries.find(servesWithoutKey);
    if (misdeclared) throw new InvalidResourceStoreError(missingKeyMessage(misdeclared.metadata.name));
    const stores = new Set(entries.flatMap((entry) => materializedEntry(entry)?.from.store ?? []));
    await Promise.all([...stores].map((store) => this.connect(store)));
    this.follow();
    this.stopRegistry = this.scope.resources.subscribe({ immediate: false }, (event) => {
      if (event.kind !== 'updated') this.follow();
    });
  }

  async stop(): Promise<void> {
    this.stopRegistry?.();
    this.stopRegistry = undefined;
    for (const unfollow of this.followed.values()) unfollow();
    this.followed.clear();
    const stores = [...this.connected];
    this.connected.clear();
    await Promise.all(stores.map((store) => store.close()));
  }

  private connect(store: ResourceStoreHandle): Promise<void> {
    this.connected.add(store);
    return store.connect();
  }

  private follow(): void {
    const current = new Map<ResourceEntry, MaterializedEntry>();
    for (const entry of this.scope.resources.listAllInstances()) {
      const materialized = materializedEntry(entry);
      if (materialized) current.set(entry, materialized);
    }
    for (const [entry, unfollow] of this.followed) {
      if (current.has(entry)) continue;
      unfollow();
      this.followed.delete(entry);
    }
    for (const [entry, { uri, from }] of current) {
      if (this.followed.has(entry)) continue;
      if (!this.connected.has(from.store)) {
        this.connect(from.store).catch((error: unknown) =>
          this.scope.logger.warn(`The store of materialized resource ${uri} could not open: ${messageOf(error)}`),
        );
      }
      this.followed.set(
        entry,
        from.subscribe(() => this.scope.resources.notifyContentChanged(uri)),
      );
    }
  }
}
