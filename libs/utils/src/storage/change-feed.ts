/**
 * Change feed: named topics whose listeners learn that something changed, in this process and in the
 * other processes that share the storage. A change carries no payload: a listener reads the current state.
 *
 * The backend follows what the storage can do:
 * - `pubsub` (Redis, Upstash, memory): a publish is a message on the topic's channel;
 * - `poll` (SQLite): a publish increments the topic's counter, and each process polls `PRAGMA data_version`,
 *   reading the counters of its topics only when another process wrote the file;
 * - `local` (no pub/sub and no data version): this process only.
 */
import type { NamespacedStorage, Unsubscribe } from './types';

export type ChangeFeedKind = 'pubsub' | 'poll' | 'local';

export interface ChangeFeedOptions {
  /** How often a `poll` feed checks whether another process wrote, in milliseconds. @default 250 */
  pollIntervalMs?: number;
  /** Changes of one topic within this window reach its listeners once, in milliseconds. @default 50 */
  coalesceMs?: number;
  /** Told of a failed poll or subscription, once until it works again, and of a listener that threw. */
  onError?: (error: unknown) => void;
}

export interface ChangeFeed {
  readonly kind: ChangeFeedKind;
  /** Tell the topic's listeners, here and in the other processes, that it changed. */
  publish(topic: string): Promise<void>;
  /** Call `listener` when `topic` changes; returns the function that stops it. */
  subscribe(topic: string, listener: () => void): () => void;
  /** Stop every listener and the polling; the storage stays connected. */
  close(): Promise<void>;
}

export const DEFAULT_CHANGE_FEED_POLL_INTERVAL_MS = 250;
export const DEFAULT_CHANGE_FEED_COALESCE_MS = 50;

const TOPIC_PREFIX = 'feed:';

abstract class TopicFeed implements ChangeFeed {
  abstract readonly kind: ChangeFeedKind;
  protected closed = false;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(protected readonly options: ChangeFeedOptions) {}

  abstract publish(topic: string): Promise<void>;

  /** Start following `topic` in the backend; called when it gets its first listener. */
  protected abstract watch(topic: string): void;

  /** Stop following `topic`; called when its last listener leaves. */
  protected abstract unwatch(topic: string): void;

  subscribe(topic: string, listener: () => void): () => void {
    let topicListeners = this.listeners.get(topic);
    if (!topicListeners) {
      topicListeners = new Set();
      this.listeners.set(topic, topicListeners);
      this.watch(topic);
    }
    const subscribed = topicListeners;
    subscribed.add(listener);
    return () => {
      if (!subscribed.delete(listener) || subscribed.size > 0 || this.listeners.get(topic) !== subscribed) return;
      this.listeners.delete(topic);
      this.unwatch(topic);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    for (const topic of this.listeners.keys()) this.unwatch(topic);
    this.listeners.clear();
  }

  /** Tell the listeners of `topic` that it changed, once per coalescing window. */
  protected changed(topic: string): void {
    if (this.closed || this.pending.has(topic) || !this.listeners.has(topic)) return;
    const timer = setTimeout(() => {
      this.pending.delete(topic);
      for (const listener of [...(this.listeners.get(topic) ?? [])]) {
        try {
          listener();
        } catch (error) {
          this.options.onError?.(error);
        }
      }
    }, this.options.coalesceMs ?? DEFAULT_CHANGE_FEED_COALESCE_MS);
    timer.unref?.();
    this.pending.set(topic, timer);
  }
}

class LocalChangeFeed extends TopicFeed {
  readonly kind = 'local';

  async publish(topic: string): Promise<void> {
    this.changed(topic);
  }

  protected watch(): void {
    return;
  }

  protected unwatch(): void {
    return;
  }
}

class PubSubChangeFeed extends TopicFeed {
  readonly kind = 'pubsub';
  private readonly channels = new Map<string, Promise<Unsubscribe | undefined>>();

  constructor(
    private readonly storage: NamespacedStorage,
    options: ChangeFeedOptions,
  ) {
    super(options);
  }

  async publish(topic: string): Promise<void> {
    await this.storage.publish(TOPIC_PREFIX + topic, '');
  }

  protected watch(topic: string): void {
    const subscription = this.storage
      .subscribe(TOPIC_PREFIX + topic, () => this.changed(topic))
      .catch((error) => {
        this.options.onError?.(error);
        return undefined;
      });
    this.channels.set(topic, subscription);
  }

  protected unwatch(topic: string): void {
    const subscription = this.channels.get(topic);
    this.channels.delete(topic);
    void subscription?.then((unsubscribe) => unsubscribe?.()).catch((error) => this.options.onError?.(error));
  }
}

/** The poll feeds of this process: stores on one file share its connection, whose data version their own writes leave. */
const pollingFeeds = new Set<PollingChangeFeed>();

class PollingChangeFeed extends TopicFeed {
  readonly kind = 'poll';
  /** The counter each followed topic had when last read; `undefined` until its first read. */
  private readonly seen = new Map<string, string | null | undefined>();
  private timer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private lastVersion?: number;
  private failing = false;

  constructor(
    private readonly storage: NamespacedStorage,
    options: ChangeFeedOptions,
  ) {
    super(options);
    pollingFeeds.add(this);
  }

  async publish(topic: string): Promise<void> {
    const counterKey = this.storage.prefix + TOPIC_PREFIX + topic;
    const count = String(await this.storage.incr(TOPIC_PREFIX + topic));
    for (const feed of pollingFeeds) feed.published(counterKey, count);
  }

  override async close(): Promise<void> {
    pollingFeeds.delete(this);
    await super.close();
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** A feed of this process incremented `counterKey` to `count`. */
  private published(counterKey: string, count: string): void {
    const ownPrefix = this.storage.prefix + TOPIC_PREFIX;
    if (!counterKey.startsWith(ownPrefix)) return;
    const topic = counterKey.slice(ownPrefix.length);
    if (!this.seen.has(topic)) return;
    this.seen.set(topic, count);
    this.changed(topic);
  }

  protected watch(topic: string): void {
    this.seen.set(topic, undefined);
    void this.storage.get(TOPIC_PREFIX + topic).then(
      (count) => {
        if (this.seen.has(topic) && this.seen.get(topic) === undefined) this.seen.set(topic, count);
      },
      (error) => this.options.onError?.(error),
    );
    this.schedule();
  }

  protected unwatch(topic: string): void {
    this.seen.delete(topic);
    if (this.seen.size > 0) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.timer || this.polling || this.closed || this.seen.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, this.options.pollIntervalMs ?? DEFAULT_CHANGE_FEED_POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    this.polling = true;
    try {
      const version = await this.storage.root.dataVersion?.();
      if (version !== this.lastVersion) {
        const topics = [...this.seen.keys()];
        const counts = await this.storage.mget(topics.map((topic) => TOPIC_PREFIX + topic));
        this.lastVersion = version;
        topics.forEach((topic, index) => this.compare(topic, counts[index]));
      }
      this.failing = false;
    } catch (error) {
      if (!this.failing) this.options.onError?.(error);
      this.failing = true;
    } finally {
      this.polling = false;
      this.schedule();
    }
  }

  private compare(topic: string, count: string | null): void {
    if (!this.seen.has(topic)) return;
    const before = this.seen.get(topic);
    this.seen.set(topic, count);
    if (before !== undefined && before !== count) this.changed(topic);
  }
}

/**
 * A change feed over `storage`, with the backend its adapter supports (see the module comment).
 *
 * @example
 * ```typescript
 * const storage = await createStorage({ type: 'sqlite', sqlite: { path: '/var/lib/app/state.sqlite' } });
 * const feed = createChangeFeed(storage);
 * const stop = feed.subscribe('board', () => console.log('board changed'));
 * await feed.publish('board');
 * ```
 */
export function createChangeFeed(storage: NamespacedStorage, options: ChangeFeedOptions = {}): ChangeFeed {
  if (storage.supportsPubSub()) return new PubSubChangeFeed(storage, options);
  if (storage.root.dataVersion) return new PollingChangeFeed(storage, options);
  return new LocalChangeFeed(options);
}
