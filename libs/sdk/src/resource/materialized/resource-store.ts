import { z } from '@frontmcp/lazy-zod';
import {
  createChangeFeed,
  createStorage,
  type ChangeFeed,
  type NamespacedStorage,
  type RootStorage,
  type StorageConfig,
} from '@frontmcp/utils';

import type {
  ProducedResourceKey,
  ResourceKey,
  ResourceKeyFamily,
  ResourceSnapshot,
  ResourceStoreHandle,
} from '../../common/metadata/materialized.metadata';
import { InvalidResourceStoreError, ResourceStoreClosedError } from '../../errors/mcp.error';
import { refuseServerStoresInBrowser } from '../../scope/browser-stores';

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

/** How a producer-backed key reruns its producer while someone subscribes. */
export interface ProducedKeyThrottle {
  /** The least time from the end of one run to the start of the next, in milliseconds; dirty marks meanwhile make one run. @default 50 */
  minIntervalMs?: number;
  /** The next run waits at least this many times as long as the last run took, so a costly producer runs less often. @default 1 */
  costFactor?: number;
}

/** A key whose value `produce` computes (`key(name, { produce })`), instead of a writer setting it. */
export interface ProducedKeyOptions<T> extends ProducedKeyThrottle {
  /**
   * Computes the value; stored as JSON like every value. It runs on a read of a dirty key, and after `markDirty()`
   * while someone subscribes, in the process that declares the key: never while the key is clean.
   */
  produce: () => T | Promise<T>;
}

/** A family of producer-backed keys: `produce` gets the parameters of the key it computes. */
export interface ProducedFamilyOptions<T> extends ProducedKeyThrottle {
  produce: (params: Record<string, string>) => T | Promise<T>;
}

const DEFAULT_MIN_INTERVAL_MS = 50;
const DEFAULT_COST_FACTOR = 1;
/** A family keeps the keys of this many parameter sets; past it, it forgets keys no one subscribes to. */
const FAMILY_KEYS_KEPT = 1_000;

const producerOptionsSchema = z
  .object({
    produce: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function', {
      message: 'produce must be a function that returns the value',
    }),
    minIntervalMs: z.number().int().nonnegative().optional(),
    costFactor: z.number().nonnegative().finite().optional(),
  })
  .strict();

function parseProducer(subject: string, options: unknown): void {
  const parsed = producerOptionsSchema.safeParse(options);
  if (parsed.success) return;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`);
  throw new InvalidResourceStoreError(`${subject}: ${problems.join('; ')}`);
}

function isProducerOptions(options: object): options is ProducedKeyThrottle & { produce: unknown } {
  return 'produce' in options;
}

/** The key name of one parameter set: the parameters in name order, as a query string. */
function memberName(family: string, params: Record<string, string>): string {
  const query = Object.keys(params)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(params[name])}`)
    .join('&');
  return `${family}?${query}`;
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
  /**
   * The storage, opened on first use. With the `epoch` a write started in, a store closed since then refuses it
   * (`ResourceStoreClosedError`) instead of opening its storage again.
   */
  storage(epoch?: number): Promise<NamespacedStorage>;
  /** Tell the listeners of `topic`; nothing once the store closed after `epoch`. */
  publish(topic: string, epoch?: number): Promise<void>;
  /** Moves on each close: storage opened after it is a new one, which may hold none of the values. */
  epoch(): number;
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
  private closes = 0;
  private readonly backend: KeyBackend = {
    storage: async (epoch) => {
      if (epoch !== undefined && epoch !== this.closes) throw new ResourceStoreClosedError();
      return (await this.open()).storage;
    },
    publish: async (topic, epoch) => {
      if (epoch === undefined || epoch === this.closes) await this.publish(topic);
    },
    epoch: () => this.closes,
    reportError: (error) => this.options.onError?.(error),
  };

  constructor(private readonly options: ResourceStoreOptions = {}) {}

  key<T>(name: string, options: ProducedKeyOptions<T>): ProducedResourceKey<T>;
  key<T>(name: string, options: ResourceKeyOptions<T> & { initial: T }): ResourceKey<T>;
  key<T>(name: string, options?: ResourceKeyOptions<T>): ResourceKey<T | undefined>;
  key<T>(
    name: string,
    options: ResourceKeyOptions<T> | ProducedKeyOptions<T> = {},
  ): ResourceKey<T | undefined> | ProducedResourceKey<T> {
    requireName('key', name);
    if (isProducerOptions(options)) {
      parseProducer(`key "${name}"`, options);
      const { produce, ...throttle } = options as ProducedKeyOptions<T>;
      return new ProducedKey<T>(this, this.backend, name, produce, throttle);
    }
    return new StoredResourceKey<T | undefined>(this, this.backend, name, initialRecordOf(name, options.initial));
  }

  /**
   * The keys of one parameter set each, for `@ResourceTemplate({ from })`: `family.key({ table: 'users' })` is the
   * key that `db://tables/users` reads. With `produce`, each key is producer-backed and `produce` gets its parameters.
   */
  family<T>(name: string, options: ProducedFamilyOptions<T>): ResourceKeyFamily<T, ProducedResourceKey<T>>;
  family<T>(name: string, options: ResourceKeyOptions<T> & { initial: T }): ResourceKeyFamily<T>;
  family<T>(name: string, options?: ResourceKeyOptions<T>): ResourceKeyFamily<T | undefined>;
  family<T>(
    name: string,
    options: ResourceKeyOptions<T> | ProducedFamilyOptions<T> = {},
  ): ResourceKeyFamily<T | undefined> | ResourceKeyFamily<T, ProducedResourceKey<T>> {
    requireName('family', name);
    if (isProducerOptions(options)) {
      parseProducer(`family "${name}"`, options);
      const { produce, ...throttle } = options as ProducedFamilyOptions<T>;
      const family: KeyFamily<T, ProducedResourceKey<T>> = new KeyFamily<T, ProducedResourceKey<T>>(
        this,
        name,
        (memberKey, params) => new ProducedKey<T>(this, this.backend, memberKey, () => produce(params), throttle),
        (memberKey, params) => new FamilyKeyHandle<T>(family, memberKey, params),
      );
      return family;
    }
    const initialRecord = initialRecordOf(name, options.initial);
    return new KeyFamily(this, name, (memberKey) => {
      return new StoredResourceKey<T | undefined>(this, this.backend, memberKey, initialRecord);
    });
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
    // A producer run that began before this close must not open the storage again when it ends.
    this.closes++;
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
    refuseServerStoresInBrowser({
      resourceStore: storage.type === 'memory' ? undefined : `storage: { type: '${storage.type}' }`,
    });
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

function requireName(kind: 'key' | 'family', name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new InvalidResourceStoreError(`a ${kind} needs a name, such as ${kind}("board")`);
  }
}

function initialRecordOf<T>(name: string, initial: T | undefined): string {
  try {
    return JSON.stringify({ value: initial, revision: 0 } satisfies StoredRecord<T | undefined>);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InvalidResourceStoreError(`the initial value of key "${name}" cannot be stored as JSON: ${reason}`);
  }
}

class StoredResourceKey<T> implements ResourceKey<T> {
  private readonly recordKey: string;

  constructor(
    readonly store: ResourceStore,
    protected readonly backend: KeyBackend,
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

  /** What a subscription reads to learn of a new revision. */
  protected current(): Promise<ResourceSnapshot<T>> {
    return this.get();
  }

  set(value: T): Promise<ResourceSnapshot<T>> {
    return this.update(() => value);
  }

  update(change: (current: T) => T | Promise<T>): Promise<ResourceSnapshot<T>> {
    return this.write(change, false);
  }

  /**
   * Store what `change` makes of the value; with `onlyIfChanged`, output with the same JSON keeps the revision. With
   * the `epoch` it began in, a write the store closed during fails instead of opening the store again.
   */
  protected async write(
    change: (current: T) => T | Promise<T>,
    onlyIfChanged: boolean,
    epoch?: number,
  ): Promise<ResourceSnapshot<T>> {
    const storage = await this.backend.storage(epoch);
    for (;;) {
      const raw = await storage.get(this.recordKey);
      if (raw === null) {
        // Every first writer stores the same revision-0 record, so the race to create it is harmless.
        await storage.set(this.recordKey, this.initialRecord, { ifNotExists: true });
        continue;
      }
      const current = this.parse(raw);
      const value = await change(current.value);
      if (onlyIfChanged && current.revision > 0 && JSON.stringify(value) === JSON.stringify(current.value)) {
        return current;
      }
      const next = JSON.stringify({
        value,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      } satisfies StoredRecord<T>);
      if (await storage.setIfEquals(this.recordKey, raw, next)) {
        await this.backend.publish(this.name, epoch).catch((error) => this.backend.reportError(error));
        return this.parse(next);
      }
    }
  }

  subscribe(listener: (snapshot: ResourceSnapshot<T>) => void): () => void {
    let active = true;
    let seen: Promise<number> = this.current().then(
      (snapshot) => snapshot.revision,
      () => -1,
    );
    const check = async (revision: number): Promise<number> => {
      if (!active) return revision;
      let snapshot: ResourceSnapshot<T>;
      try {
        snapshot = await this.current();
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
 * A key whose value `produce` computes. It is dirty until its first run in this process, and again after each
 * `markDirty()`. A read of a dirty key runs the producer and waits for it; while someone subscribes, a dirty key runs
 * it on a timer, no sooner than `minIntervalMs` and `costFactor` times the last run's duration after the last run, so
 * a burst of dirty marks makes one run. A run whose output has the JSON already stored keeps the revision.
 */
class ProducedKey<T> extends StoredResourceKey<T> implements ProducedResourceKey<T> {
  /** Moves on each `markDirty()`; the key is clean once a run that started at the current one has stored its output. */
  private generation = 1;
  private producedGeneration = 0;
  /** The store's epoch the stored output was produced in: after a close, the reopened storage may not hold it. */
  private producedEpoch = -1;
  private run?: Promise<ResourceSnapshot<T>>;
  private runGeneration = 0;
  private runEpoch = -1;
  private timer?: ReturnType<typeof setTimeout>;
  private subscribers = 0;
  private lastEndedAt = -Infinity;
  private lastDurationMs = 0;
  private readonly minIntervalMs: number;
  private readonly costFactor: number;

  constructor(
    store: ResourceStore,
    backend: KeyBackend,
    name: string,
    private readonly produce: () => T | Promise<T>,
    throttle: ProducedKeyThrottle,
  ) {
    super(store, backend, name, initialRecordOf(name, undefined));
    this.minIntervalMs = throttle.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.costFactor = throttle.costFactor ?? DEFAULT_COST_FACTOR;
  }

  /** No one subscribes and no run is due or running: what a family may forget. */
  get idle(): boolean {
    return this.subscribers === 0 && !this.run && !this.timer;
  }

  markDirty(): void {
    this.generation++;
    if (this.subscribers > 0) this.schedule();
  }

  override async get(): Promise<ResourceSnapshot<T>> {
    for (;;) {
      if (!this.run) return this.dirty ? this.start() : super.get();
      if (this.runGeneration === this.generation && this.runEpoch === this.backend.epoch()) return this.run;
      await this.run.catch(() => undefined);
    }
  }

  /** Marked dirty since the last stored run, or the store closed since then, so its storage may not hold the output. */
  private get dirty(): boolean {
    return this.producedGeneration < this.generation || this.producedEpoch !== this.backend.epoch();
  }

  /** A subscription reads the stored value: only a read or the throttled timer runs the producer. */
  protected override current(): Promise<ResourceSnapshot<T>> {
    return super.get();
  }

  override subscribe(listener: (snapshot: ResourceSnapshot<T>) => void): () => void {
    this.subscribers++;
    const stop = super.subscribe(listener);
    this.schedule();
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      stop();
      if (--this.subscribers > 0) return;
      clearTimeout(this.timer);
      this.timer = undefined;
    };
  }

  private schedule(): void {
    if (this.timer || this.run || !this.dirty) return;
    const waitMs = Math.max(this.minIntervalMs, this.lastDurationMs * this.costFactor);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (this.subscribers > 0 && !this.run && this.dirty) {
          // start() reports the failure; no read waits for this run.
          this.start().catch(() => undefined);
        }
      },
      Math.max(0, this.lastEndedAt + waitMs - performance.now()),
    );
    this.timer.unref?.();
  }

  private start(): Promise<ResourceSnapshot<T>> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const generation = (this.runGeneration = this.generation);
    const epoch = (this.runEpoch = this.backend.epoch());
    const startedAt = performance.now();
    const run = this.produceAndStore(generation, epoch);
    this.run = run;
    const settle = (produced: boolean) => {
      this.lastEndedAt = performance.now();
      this.lastDurationMs = this.lastEndedAt - startedAt;
      if (this.run === run) this.run = undefined;
      // A failed run waits for the next dirty mark or read, so a failing producer is not rerun on every interval.
      if (this.subscribers > 0 && (produced || this.generation !== generation)) this.schedule();
    };
    // Every failed run is told to onError once, here: one a read started fails that read too.
    run.then(
      () => settle(true),
      (error: unknown) => {
        settle(false);
        // A run the store closed under failed for no fault of the producer.
        if (!(error instanceof ResourceStoreClosedError)) this.backend.reportError(error);
      },
    );
    return run;
  }

  private async produceAndStore(generation: number, epoch: number): Promise<ResourceSnapshot<T>> {
    const value = await this.produce();
    let snapshot: ResourceSnapshot<T>;
    try {
      snapshot = await this.write(() => value, true, epoch);
    } catch (error) {
      throw error instanceof ResourceStoreClosedError ? new ResourceStoreClosedError(this.name) : error;
    }
    this.producedGeneration = Math.max(this.producedGeneration, generation);
    this.producedEpoch = epoch;
    return snapshot;
  }
}

/**
 * What `key(params)` of a computed family returns: each call goes to the key the family holds for those parameters
 * now, made again if the family forgot it. So a handle a caller kept after the family forgot its idle key still
 * marks, reads and follows the key that resources serve, instead of a stale copy of its own.
 */
class FamilyKeyHandle<T> implements ProducedResourceKey<T> {
  constructor(
    private readonly family: KeyFamily<T, ProducedResourceKey<T>>,
    readonly name: string,
    private readonly params: Record<string, string>,
  ) {}

  get store(): ResourceStore {
    return this.family.store;
  }

  get(): Promise<ResourceSnapshot<T>> {
    return this.family.liveKey(this.params).get();
  }

  set(value: T): Promise<ResourceSnapshot<T>> {
    return this.family.liveKey(this.params).set(value);
  }

  update(change: (current: T) => T | Promise<T>): Promise<ResourceSnapshot<T>> {
    return this.family.liveKey(this.params).update(change);
  }

  subscribe(listener: (snapshot: ResourceSnapshot<T>) => void): () => void {
    return this.family.liveKey(this.params).subscribe(listener);
  }

  markDirty(): void {
    this.family.liveKey(this.params).markDirty();
  }
}

interface FamilyMember<Key> {
  /** The key that holds the state. */
  key: Key;
  /** What `key(params)` returns: the key itself, or, for a computed family, a handle that follows the live key. */
  handle: Key;
}

/** The keys of a family by parameter set, made on first use; past {@link FAMILY_KEYS_KEPT}, idle ones are forgotten. */
class KeyFamily<T, Key extends ResourceKey<T>> implements ResourceKeyFamily<T, Key> {
  private readonly members = new Map<string, FamilyMember<Key>>();

  constructor(
    readonly store: ResourceStore,
    readonly name: string,
    private readonly create: (memberKey: string, params: Record<string, string>) => Key,
    private readonly handleOf?: (memberKey: string, params: Record<string, string>) => Key,
  ) {}

  key(params: Record<string, string>): Key {
    return this.member(params).handle;
  }

  /** The key the family holds for `params` now, made again if it was forgotten. */
  liveKey(params: Record<string, string>): Key {
    return this.member(params).key;
  }

  private member(params: Record<string, string>): FamilyMember<Key> {
    const memberKey = memberName(this.name, params);
    let member = this.members.get(memberKey);
    if (member) {
      this.members.delete(memberKey);
    } else {
      const key = this.create(memberKey, { ...params });
      member = { key, handle: this.handleOf ? this.handleOf(memberKey, { ...params }) : key };
    }
    this.members.set(memberKey, member);
    this.forgetIdleKeys(memberKey);
    return member;
  }

  /** Forgets the oldest idle keys past the limit, never `returning`: its caller is about to use it, idle as it is. */
  private forgetIdleKeys(returning: string): void {
    for (const [memberKey, { key }] of this.members) {
      if (this.members.size <= FAMILY_KEYS_KEPT) return;
      if (memberKey === returning) continue;
      if (!(key instanceof ProducedKey) || key.idle) this.members.delete(memberKey);
    }
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
