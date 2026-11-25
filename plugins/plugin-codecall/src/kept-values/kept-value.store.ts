import type { ReferenceEntry } from '@enclave-vm/core/worker';

import { resultOwnerOf, type ResultHandleStore, type ResultOwner } from '@frontmcp/plugin-result-handles';
import type { OnShutdown } from '@frontmcp/sdk';
import { sha256Hex } from '@frontmcp/utils';

import { jsonBytes } from '../runs/run-journal';
import type { CodeCallRunCaller } from '../runs/run-record.store';
import { KeptValueCalls, type KeptValueCallsOptions } from './kept-value-calls';
import type { KeptValue } from './kept-value.types';

export interface KeptValueStoreOptions {
  ttlSeconds: number;
  maxBytes: number;
}

/** A name an owner keeps a value under, with its size and when it expires. */
interface KeptName {
  name: string;
  bytes: number;
  expiresAt: number;
  reference: boolean;
}

/** A handle the store takes, from a SHA-256 of `key`: the storage never sees a name. */
function handleOf(key: string): string {
  const hex = sha256Hex(`codecall-kept:${key}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const INDEX_HANDLE = handleOf('index');

/**
 * Values scripts keep, in a {@link ResultHandleStore}: each encrypted under keys of its name and owner, readable by that
 * owner until `ttlSeconds` runs out. An index per owner counts what its live values take against `maxBytes`; two runs
 * of one owner that keep at the same time can each count without the other.
 */
export class KeptValueStore implements OnShutdown {
  constructor(
    private readonly handles: ResultHandleStore,
    private readonly options: KeptValueStoreOptions,
  ) {}

  /** `keep` and `recall` for one run, for the owner of the tool context it runs in. */
  callsFor(caller: CodeCallRunCaller, options: Omit<KeptValueCallsOptions, 'store' | 'owner'>): KeptValueCalls {
    return new KeptValueCalls({ ...options, store: this, owner: resultOwnerOf(caller) });
  }

  /** Keeps `kept` under `name` for `owner`, in place of what it held; a RangeError past `maxBytes`. */
  async keep(owner: ResultOwner, name: string, kept: KeptValue): Promise<void> {
    const now = Date.now();
    const bytes = jsonBytes(kept);
    const others = (await this.liveNamesOf(owner, now)).filter((entry) => entry.name !== name);
    const keptBytes = others.reduce((sum, entry) => sum + entry.bytes, 0) + bytes;
    if (keptBytes > this.options.maxBytes) {
      throw new RangeError(
        `Keeping "${name}" (${bytes} bytes) would bring what this session and caller keep to ${keptBytes} bytes, ` +
          `over the ${this.options.maxBytes}-byte limit. Keep less, or let earlier values expire.`,
      );
    }
    await this.handles.save(handleOf(`name:${name}`), kept, owner);
    const entry: KeptName = {
      name,
      bytes,
      expiresAt: now + this.options.ttlSeconds * 1000,
      reference: 'reference' in kept,
    };
    await this.handles.save(INDEX_HANDLE, [...others, entry], owner);
  }

  /** The value kept under `name`, or undefined when it expired, was never kept, or `owner` did not keep it. */
  async recall(owner: ResultOwner, name: string): Promise<KeptValue | undefined> {
    const stored = await this.handles.read(handleOf(`name:${name}`), owner);
    return stored?.value as KeptValue | undefined;
  }

  /** The sidecar entries of the live large values `owner` keeps under `names`. */
  async referencesOf(owner: ResultOwner, names: readonly string[]): Promise<ReferenceEntry[]> {
    const wanted = new Set(names);
    const references = (await this.liveNamesOf(owner, Date.now())).filter(
      (entry) => entry.reference && wanted.has(entry.name),
    );
    const kept = await Promise.all(references.map((entry) => this.recall(owner, entry.name)));
    return kept.flatMap((value) => (value && 'reference' in value ? [value.reference] : []));
  }

  async onShutdown(): Promise<void> {
    await this.handles.onShutdown();
  }

  private async liveNamesOf(owner: ResultOwner, now: number): Promise<KeptName[]> {
    const stored = (await this.handles.read(INDEX_HANDLE, owner))?.value;
    return Array.isArray(stored) ? (stored as KeptName[]).filter((entry) => entry.expiresAt > now) : [];
  }
}
