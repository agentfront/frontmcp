import type { ReferenceEntry } from '@enclave-vm/core/worker';

import { ResultHandleStore, resultOwnerOf, type ResultOwner } from '@frontmcp/plugin-result-handles';
import type { OnShutdown } from '@frontmcp/sdk';
import { randomUUID, sha256Hex, type NamespacedStorage } from '@frontmcp/utils';

import { jsonBytes } from '../runs/run-journal';
import type { CodeCallRunCaller } from '../runs/run-record.store';
import { KeptValueCalls, type KeptValueCallsOptions } from './kept-value-calls';
import type { KeptValue } from './kept-value.types';

export interface KeptValueStoreOptions {
  ttlSeconds: number;
  maxBytes: number;
}

/** A kept value as stored: with the bytes it counts, the window they count in, and the slot that releases them once. */
interface StoredValue {
  kept: KeptValue;
  bytes: number;
  window: number;
  slot: string;
}

/** The most names one run starts with the large values of. */
const MAX_PRELOADED_NAMES = 100;

/** A handle the store takes, from a SHA-256 of the name: the storage never sees a name. */
function handleOf(name: string): string {
  const hex = sha256Hex(`codecall-kept:name:${name}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function countedKeyOf(owner: ResultOwner, window: number): string {
  return `bytes:${sha256Hex(JSON.stringify([owner.session ?? null, owner.caller ?? null]))}:${window}`;
}

/**
 * Values scripts keep: each encrypted in a {@link ResultHandleStore} under keys of its name and owner, readable by that
 * owner until `ttlSeconds` runs out. What an owner keeps counts against `maxBytes` in atomic counters, one per window
 * of `ttlSeconds`: a value counts in the window it was kept in, the current and the previous windows count together,
 * so a value counts at most twice its TTL. Bytes are reserved before the value is written and released if it isn't;
 * the value a keep replaces leaves room for it, and releases what it counted once the new one is written.
 */
export class KeptValueStore implements OnShutdown {
  private readonly handles: ResultHandleStore;

  constructor(
    private readonly storage: NamespacedStorage,
    private readonly options: KeptValueStoreOptions,
  ) {
    this.handles = new ResultHandleStore(storage, options.ttlSeconds);
  }

  /** `keep` and `recall` for one run, for the owner of the tool context it runs in. */
  callsFor(caller: CodeCallRunCaller, options: Omit<KeptValueCallsOptions, 'store' | 'owner'>): KeptValueCalls {
    return new KeptValueCalls({ ...options, store: this, owner: resultOwnerOf(caller) });
  }

  /** Keeps `kept` under `name` for `owner`, in place of what it held; a RangeError past `maxBytes`, keeping nothing. */
  async keep(owner: ResultOwner, name: string, kept: KeptValue): Promise<void> {
    const bytes = jsonBytes(kept);
    const window = Math.floor(Date.now() / (this.options.ttlSeconds * 1000));
    const counter = countedKeyOf(owner, window);
    const reserved = await this.storage.incrBy(counter, bytes);
    let previous: StoredValue | undefined;
    try {
      await this.storage.expire(counter, 2 * this.options.ttlSeconds);
      previous = await this.storedValueOf(owner, name);
      const before = Number(await this.storage.get(countedKeyOf(owner, window - 1))) || 0;
      const counted = Math.max(reserved, 0) + Math.max(before, 0) - (previous?.bytes ?? 0);
      if (counted > this.options.maxBytes) {
        throw new RangeError(
          `Keeping "${name}" (${bytes} bytes) would bring what this session and caller keep to ${counted} bytes, ` +
            `over the ${this.options.maxBytes}-byte limit. Keep less, or let earlier values expire.`,
        );
      }
      await this.handles.save(handleOf(name), { kept, bytes, window, slot: randomUUID() }, owner);
    } catch (error: unknown) {
      await this.storage.incrBy(counter, -bytes);
      throw error;
    }
    // A value left counted only counts until its window passes; the new value is kept either way.
    if (previous) await this.releaseOnce(owner, previous).catch(() => undefined);
  }

  /** The value kept under `name`, or undefined when it expired, was never kept, or `owner` did not keep it. */
  async recall(owner: ResultOwner, name: string): Promise<KeptValue | undefined> {
    return (await this.storedValueOf(owner, name))?.kept;
  }

  /** The sidecar entries of the large values `owner` keeps under `names`. */
  async referencesOf(owner: ResultOwner, names: readonly string[]): Promise<ReferenceEntry[]> {
    const wanted = [...new Set(names)].slice(0, MAX_PRELOADED_NAMES);
    const kept = await Promise.all(wanted.map((name) => this.recall(owner, name)));
    return kept.flatMap((value) => (value && 'reference' in value ? [value.reference] : []));
  }

  async onShutdown(): Promise<void> {
    await this.handles.onShutdown();
  }

  private async storedValueOf(owner: ResultOwner, name: string): Promise<StoredValue | undefined> {
    return (await this.handles.read(handleOf(name), owner))?.value as StoredValue | undefined;
  }

  /** Releases what a replaced value counted, once, however many keeps replaced it at the same time. */
  private async releaseOnce(owner: ResultOwner, { slot, window, bytes }: StoredValue): Promise<void> {
    const releasedKey = `released:${slot}`;
    if ((await this.storage.incr(releasedKey)) !== 1) return;
    await this.storage.expire(releasedKey, 2 * this.options.ttlSeconds);
    await this.storage.incrBy(countedKeyOf(owner, window), -bytes);
  }
}
