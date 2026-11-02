import { z } from '@frontmcp/lazy-zod';

/** A stored value with its revision: what a materialized resource serves. */
export interface ResourceSnapshot<T> {
  readonly value: T;
  /** 0 until the first write; every write adds 1. */
  readonly revision: number;
  /** When the value was last written, as an ISO 8601 time; absent before the first write. */
  readonly updatedAt?: string;
}

/** The part of a resource store a key needs: `resourceStore()` returns one. */
export interface ResourceStoreHandle {
  /** Open the storage and the change feed; a server calls it at boot for the stores its resources use. */
  connect(): Promise<void>;
  /** Close the change feed and the storage once every `connect()` has had its `close()`; the next use opens them again. */
  close(): Promise<void>;
}

/**
 * One value in a resource store (`resourceStore().key(name)`), which `@Resource({ from })` serves.
 * Writes are atomic in every process that shares the storage, and each one adds 1 to the revision.
 * Values are stored as JSON: every read and write returns a JSON copy.
 */
export interface ResourceKey<T = unknown> {
  readonly name: string;
  readonly store: ResourceStoreHandle;
  get(): Promise<ResourceSnapshot<T>>;
  set(value: T): Promise<ResourceSnapshot<T>>;
  /** Replace the value with what `change` makes of it. `change` runs again when another write came first, so keep it pure. */
  update(change: (current: T) => T | Promise<T>): Promise<ResourceSnapshot<T>>;
  /** Call `listener` when the revision changes, from a write in any process; returns the function that stops it. */
  subscribe(listener: (snapshot: ResourceSnapshot<T>) => void): () => void;
}

export function isResourceKey(value: unknown): value is ResourceKey {
  const candidate = value as Partial<ResourceKey> | null | undefined;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.name === 'string' &&
    typeof candidate.get === 'function' &&
    typeof candidate.set === 'function' &&
    typeof candidate.update === 'function' &&
    typeof candidate.subscribe === 'function' &&
    typeof candidate.store?.connect === 'function' &&
    typeof candidate.store.close === 'function'
  );
}

export const resourceKeySchema = z.custom<ResourceKey>(isResourceKey, {
  message: "`from` must be a key of a resource store, such as resourceStore().key('board')",
});
