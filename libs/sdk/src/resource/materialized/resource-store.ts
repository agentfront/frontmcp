import { z } from '@frontmcp/lazy-zod';
import {
  createChangeFeed,
  createStorage,
  type ChangeFeed,
  type NamespacedStorage,
  type RootStorage,
  type StorageConfig,
} from '@frontmcp/utils';

import type { ResourceKey, ResourceSnapshot, ResourceStoreHandle } from '../../common/metadata/materialized.metadata';
import { InvalidResourceStoreError } from '../../errors/mcp.error';

/** The backends with an atomic `setIfEquals`, which every write uses. */
const STORAGE_TYPES = ['memory', 'redis', 'sqlite'] as const;

/** A `createStorage()` config on a backend a resource store can write atomically. */
export type ResourceStoreStorage = StorageConfig & { type: (typeof STORAGE_TYPES)[number] };

export interface ResourceStoreOptions {
  /**
   * Where the values live, through the storage factory: `memory` (the default) serves this process only; `sqlite`
   * and `redis` are shared by every process that opens the same file or server, and each of them hears the others'
   * writes. Only these three have the atomic compare-and-set a write needs. Unless you set `fallback`, a backend
   * that fails to open is an error, not a silent switch to memory.
   */
  storage?: ResourceStoreStorage;
  /** How often a SQLite store checks `PRAGMA data_version` for another process's write, in milliseconds. @default 250 */
  pollIntervalMs?: number;
  /** Writes to one key within this window are announced once, in milliseconds. @default 50 */
  coalesceMs?: number;
  /** Told of a failed poll, subscription or announcement, and of a listener that threw. */
  onError?: (error: unknown) => void;
}

export interface ResourceKeyOptions<T> {
  /** The value read before the first write; stored as JSON like every value, so it must be one JSON can hold. */
  initial?: T;
}

const resourceStoreOptionsSchema = z
  .object({
    storage: z
      .object({ type: z.enum(STORAGE_TYPES) })
      .passthrough()
      .optional(),
    pollIntervalMs: z.number().int().positive().optional(),
    coalesceMs: z.number().int().nonnegative().optional(),
    onError: z.custom<(error: unknown) => void>((value) => typeof value === 'function').optional(),
  })
  .strict();

interface StoredRecord<T> {
  value: T;
  revision: number;
  updatedAt?: string;
}

interface OpenStore {
  storage: NamespacedStorage;
  root: RootStorage;
  feed: ChangeFeed;
}

/** What a key needs from its store beyond the public API. */
interface KeyBackend {
  storage(): Promise<NamespacedStorage>;
  reportError(error: unknown): void;
}

const NAMESPACE = 'frontmcp-resources';

/**
 * Values with a revision, kept in a storage that several processes can share; `@Resource({ from: store.key(name) })`
 * serves one of them, and its subscribers learn of every write. The topic API (`subscribe`, `publish`) is the same
 * change feed, for other live views such as SSE routes: a key's topic is its name.
 */
export class ResourceStore implements ResourceStoreHandle {
  private opened?: Promise<OpenStore>;
  private connections = 0;
  private readonly backend: KeyBackend = {
    storage: async () => (await this.open()).storage,
    reportError: (error) => this.options.onError?.(error),
  };

  constructor(private readonly options: ResourceStoreOptions = {}) {}

  key<T>(name: string, options: ResourceKeyOptions<T> & { initial: T }): ResourceKey<T>;
  key<T>(name: string, options?: ResourceKeyOptions<T>): ResourceKey<T | undefined>;
  key<T>(name: string, options: ResourceKeyOptions<T> = {}): ResourceKey<T | undefined> {
    if (typeof name !== 'string' || name.length === 0) {
      throw new InvalidResourceStoreError('a key needs a name, such as key("board")');
    }
    let initialRecord: string;
    try {
      initialRecord = JSON.stringify({ value: options.initial, revision: 0 } satisfies StoredRecord<T | undefined>);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new InvalidResourceStoreError(`the initial value of key "${name}" cannot be stored as JSON: ${reason}`);
    }
    return new StoredResourceKey<T | undefined>(this, this.backend, name, initialRecord);
  }

  /** Call `listener` when `topic` is published, in this process or in another one that shares the storage. */
  subscribe(topic: string, listener: () => void): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    this.open().then(
      ({ feed }) => {
        if (!stopped) unsubscribe = feed.subscribe(topic, listener);
      },
      (error) => this.backend.reportError(error),
    );
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }

  /** Tell the listeners of `topic`, here and in the other processes, that it changed. */
  async publish(topic: string): Promise<void> {
    const { feed } = await this.open();
    await feed.publish(topic);
  }

  /** Open the storage and the change feed; the store stays open until each `connect()` has had its `close()`. */
  async connect(): Promise<void> {
    this.connections++;
    try {
      await this.open();
    } catch (error) {
      this.connections--;
      throw error;
    }
  }

  /** Close the feed and the storage, unless another `connect()` still holds them; the next use opens them again. */
  async close(): Promise<void> {
    if (this.connections > 1) {
      this.connections--;
      return;
    }
    this.connections = 0;
    const opened = this.opened;
    this.opened = undefined;
    if (!opened) return;
    const { feed, root } = await opened.catch(() => ({ feed: undefined, root: undefined }));
    await feed?.close();
    await root?.disconnect();
  }

  private open(): Promise<OpenStore> {
    if (!this.opened) {
      const opening = this.openStorage();
      opening.catch(() => {
        if (this.opened === opening) this.opened = undefined;
      });
      this.opened = opening;
    }
    return this.opened;
  }

  private async openStorage(): Promise<OpenStore> {
    const { storage = { type: 'memory' }, pollIntervalMs, coalesceMs } = this.options;
    const root = await createStorage({ fallback: 'error', ...storage });
    const namespaced = root.namespace(NAMESPACE);
    const feed = createChangeFeed(namespaced, {
      pollIntervalMs,
      coalesceMs,
      onError: (error) => this.backend.reportError(error),
    });
    return { root, storage: namespaced, feed };
  }
}

class StoredResourceKey<T> implements ResourceKey<T> {
  private readonly recordKey: string;

  constructor(
    readonly store: ResourceStore,
    private readonly backend: KeyBackend,
    readonly name: string,
    /** The revision-0 record, as JSON: what a read serves until the first write, and what that write starts from. */
    private readonly initialRecord: string,
  ) {
    this.recordKey = `value:${name}`;
  }

  async get(): Promise<ResourceSnapshot<T>> {
    const storage = await this.backend.storage();
    return this.parse(await storage.get(this.recordKey));
  }

  set(value: T): Promise<ResourceSnapshot<T>> {
    return this.update(() => value);
  }

  async update(change: (current: T) => T | Promise<T>): Promise<ResourceSnapshot<T>> {
    const storage = await this.backend.storage();
    for (;;) {
      const raw = await storage.get(this.recordKey);
      if (raw === null) {
        // Every first writer stores the same revision-0 record, so the race to create it is harmless.
        await storage.set(this.recordKey, this.initialRecord, { ifNotExists: true });
        continue;
      }
      const current = this.parse(raw);
      const next = JSON.stringify({
        value: await change(current.value),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      } satisfies StoredRecord<T>);
      if (await storage.setIfEquals(this.recordKey, raw, next)) {
        await this.store.publish(this.name).catch((error) => this.backend.reportError(error));
        return this.parse(next);
      }
    }
  }

  subscribe(listener: (snapshot: ResourceSnapshot<T>) => void): () => void {
    let active = true;
    let seen: Promise<number> = this.get().then(
      (snapshot) => snapshot.revision,
      () => -1,
    );
    const check = async (revision: number): Promise<number> => {
      let snapshot: ResourceSnapshot<T>;
      try {
        snapshot = await this.get();
      } catch (error) {
        this.backend.reportError(error);
        return revision;
      }
      if (!active || snapshot.revision === revision) return snapshot.revision;
      try {
        listener(snapshot);
      } catch (error) {
        this.backend.reportError(error);
      }
      return snapshot.revision;
    };
    const stop = this.store.subscribe(this.name, () => {
      seen = seen.then(check);
    });
    return () => {
      active = false;
      stop();
    };
  }

  private parse(raw: string | null): ResourceSnapshot<T> {
    const record = JSON.parse(raw ?? this.initialRecord) as StoredRecord<T>;
    return record.updatedAt === undefined
      ? { value: record.value, revision: record.revision }
      : { value: record.value, revision: record.revision, updatedAt: record.updatedAt };
  }
}

/**
 * Declare a resource store: values with a revision that `@Resource({ from: store.key(name) })` serves and keeps its
 * subscribers up to date with, from a write in any process that shares the storage.
 *
 * @example
 * ```typescript
 * export const lens = resourceStore({ storage: { type: 'sqlite', sqlite: { path: '.lens/state.sqlite' } } });
 * export const slowQueries = lens.key<SlowQuery[]>('slow-queries', { initial: [] });
 *
 * @Resource({ name: 'slow-queries', uri: 'db://slow-queries', mimeType: 'application/json', from: slowQueries })
 * export class SlowQueriesResource extends MaterializedResourceContext {}
 *
 * // In a tool, a reducer or another process:
 * await slowQueries.update((queries) => [...queries, query]);
 * ```
 */
export function resourceStore(options: ResourceStoreOptions = {}): ResourceStore {
  const parsed = resourceStoreOptionsSchema.safeParse(options);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`);
    throw new InvalidResourceStoreError(problems.join('; '));
  }
  return new ResourceStore(options);
}
