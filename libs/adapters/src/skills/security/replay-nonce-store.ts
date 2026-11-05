// file: libs/adapters/src/skills/security/replay-nonce-store.ts
//
// Where the push replay guard records the nonces (push token `jti`s) it accepted.

import { createStorage, randomUUID, type StorageAdapter, type StorageConfig } from '@frontmcp/utils';

/**
 * Records each nonce the replay guard accepts. Every instance that serves the server must share one store, or a push
 * replayed to another replica or Worker isolate is accepted again.
 */
export interface ReplayNonceStore {
  /**
   * Record `key` as used for `ttlMs`. Resolves true when this call recorded it, false when it is already recorded and
   * not expired. Throws when the store can't be read or written: the guard then refuses the push.
   */
  claim(key: string, ttlMs: number): Promise<boolean>;
}

export interface MemoryReplayNonceStoreOptions {
  /** Max nonces tracked at once (default 5_000); at capacity, the one that expires first is dropped. */
  capacity?: number;
  /** The time source, for tests. */
  now?: () => number;
}

const DEFAULT_CAPACITY = 5_000;

/** A {@link ReplayNonceStore} in this process's memory: enough for one process, never for replicas or isolates. */
export class MemoryReplayNonceStore implements ReplayNonceStore {
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly expiries = new Map<string, number>();

  constructor(options: MemoryReplayNonceStoreOptions = {}) {
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('MemoryReplayNonceStore: capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.now = options.now ?? Date.now;
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    const now = this.now();
    const expiresAt = this.expiries.get(key);
    // A nonce whose expiry is now is still tracked, so it can't be replayed at the window's last tick.
    if (expiresAt !== undefined && expiresAt >= now) return false;
    if (this.expiries.size >= this.capacity) this.prune();
    if (this.expiries.size >= this.capacity) this.evictFirstToExpire();
    this.expiries.set(key, now + ttlMs);
    return true;
  }

  /** Drop the expired nonces; returns how many were dropped. */
  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, expiresAt] of this.expiries) {
      if (expiresAt < now) {
        this.expiries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** How many nonces are tracked. */
  get size(): number {
    return this.expiries.size;
  }

  /** Insertion order says nothing about expiry (a token's `iat` can be older or newer than now), so search. */
  private evictFirstToExpire(): void {
    let victimKey: string | undefined;
    let victimExpiry = Number.POSITIVE_INFINITY;
    for (const [candidateKey, candidateExpiry] of this.expiries) {
      if (candidateExpiry < victimExpiry) {
        victimKey = candidateKey;
        victimExpiry = candidateExpiry;
      }
    }
    if (victimKey !== undefined) this.expiries.delete(victimKey);
  }
}

/**
 * A {@link ReplayNonceStore} on a `@frontmcp/utils` storage that every replica reaches (Redis, Upstash, Vercel KV,
 * SQLite). A nonce is written once, with the TTL, only when absent; the write that stored its own claim id won.
 */
export class StorageReplayNonceStore implements ReplayNonceStore {
  constructor(private readonly storage: StorageAdapter) {}

  async claim(key: string, ttlMs: number): Promise<boolean> {
    const claimId = randomUUID();
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.storage.set(key, claimId, { ttlSeconds, ifNotExists: true });
    return (await this.storage.get(key)) === claimId;
  }
}

/**
 * A {@link StorageReplayNonceStore} on the storage `config` describes, under `namespace`. It connects on the first
 * claim, and again on the next one after a failed connection; it never falls back to memory.
 */
export function createStorageReplayNonceStore(config: StorageConfig, namespace: string): ReplayNonceStore {
  let connecting: Promise<ReplayNonceStore> | undefined;
  const connect = async (): Promise<ReplayNonceStore> => {
    const root = await createStorage({ ...config, fallback: 'error' });
    return new StorageReplayNonceStore(root.namespace(namespace));
  };
  return {
    async claim(key: string, ttlMs: number): Promise<boolean> {
      connecting ??= connect();
      let store: ReplayNonceStore;
      try {
        store = await connecting;
      } catch (error) {
        connecting = undefined;
        throw error;
      }
      return store.claim(key, ttlMs);
    },
  };
}
