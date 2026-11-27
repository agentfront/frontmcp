import type { OnShutdown } from '@frontmcp/sdk';
import {
  base64urlEncode,
  deserializeAndDecrypt,
  encryptAndSerialize,
  hkdfSha256,
  randomUUID,
  type NamespacedStorage,
} from '@frontmcp/utils';

/** Who may read a folded answer: the session and the authenticated caller it was folded for. */
export interface ResultOwner {
  /** The verified session; undefined on a transport without sessions. */
  session?: string;
  /** The authenticated subject; undefined for an anonymous caller. */
  caller?: string;
}

const HANDLE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const encoder = new TextEncoder();
const KEY_SALT = encoder.encode('frontmcp-result-handles-v1');

/** A 32-byte secret of `handle` and `owner`: the storage key (`'id'`) or the AES-256-GCM key (`'key'`) of an answer. */
function deriveFromHandle(purpose: 'id' | 'key', handle: string, owner: ResultOwner): Uint8Array {
  const info = encoder.encode(JSON.stringify([purpose, owner.session ?? null, owner.caller ?? null]));
  return hkdfSha256(encoder.encode(handle), KEY_SALT, info, 32);
}

function storageKeyOf(handle: string, owner: ResultOwner): string {
  return base64urlEncode(deriveFromHandle('id', handle, owner));
}

/** The caller of a tool or a hook's call: its verified session and, unless anonymous, its subject. */
export function resultOwnerOf(context: {
  tryGetContext(): { verifiedSessionId?: string } | undefined;
  auth: { isAnonymous: boolean; user: { sub?: string } };
}): ResultOwner {
  const session = context.tryGetContext()?.verifiedSessionId;
  const caller = context.auth.isAnonymous ? undefined : context.auth.user.sub;
  return { ...(session && { session }), ...(caller && { caller }) };
}

/** How long a store keeps its answers past their first TTL, and how many bytes of them. */
export interface ResultHandleRetention {
  /** Each read starts the answer's TTL again. */
  slidingTtl?: boolean;
  /** The most bytes of stored answers; past it the least recently saved or read go first. */
  maxStoredBytes?: number;
}

/** Folded answers, encrypted under keys derived from their handle and owner, each readable by that owner until its TTL. */
export class ResultHandleStore implements OnShutdown {
  /** The size and expiry of each answer this store saved, least recently used first, while `maxStoredBytes` is set. */
  private readonly kept = new Map<string, { bytes: number; expiresAt: number }>();
  private keptBytes = 0;
  /** The saves under `maxStoredBytes`, one at a time: each counts, drops and writes before the next counts. */
  private saving: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: NamespacedStorage,
    private readonly ttlSeconds: number,
    private readonly retention: ResultHandleRetention = {},
  ) {}

  /** A new handle: a random UUID, which says nothing about the answer it will hold. */
  newHandle(): string {
    return randomUUID();
  }

  /** Keep `value` under `handle` for `owner` until the TTL, the store's or `ttlSeconds`, runs out. */
  async save(handle: string, value: unknown, owner: ResultOwner, ttlSeconds = this.ttlSeconds): Promise<void> {
    const encrypted = encryptAndSerialize(value, deriveFromHandle('key', handle, owner));
    const key = storageKeyOf(handle, owner);
    if (this.retention.maxStoredBytes === undefined) {
      await this.storage.set(key, encrypted, { ttlSeconds });
      return;
    }
    // A save that counted and dropped while another was still writing could drop that one, which then stored uncounted.
    const saved = this.saving.then(() => this.saveCounted(key, encrypted, ttlSeconds));
    this.saving = saved.catch(() => undefined);
    await saved;
  }

  private async saveCounted(key: string, encrypted: string, ttlSeconds: number): Promise<void> {
    await this.makeRoom(key, encrypted.length, ttlSeconds);
    try {
      await this.storage.set(key, encrypted, { ttlSeconds });
    } catch (error) {
      this.forget(key);
      throw error;
    }
  }

  /** The value under `handle`, or undefined when it expired, never existed, or `owner` is not its owner. */
  async read(handle: string, owner: ResultOwner): Promise<{ value: unknown } | undefined> {
    if (!HANDLE.test(handle)) return undefined;
    const key = storageKeyOf(handle, owner);
    const stored = await this.storage.get(key);
    if (stored === null) {
      this.forget(key);
      return undefined;
    }
    let value: unknown;
    try {
      value = deserializeAndDecrypt(stored, deriveFromHandle('key', handle, owner));
    } catch {
      return undefined;
    }
    await this.touch(key);
    return { value };
  }

  /**
   * Counts `bytes` under `key` and drops the least recently used answers past `maxStoredBytes`. The dropped ones stay
   * counted until the storage has deleted them; when it cannot, `key` is not counted either, and the save fails.
   */
  private async makeRoom(key: string, bytes: number, ttlSeconds: number): Promise<void> {
    const { maxStoredBytes } = this.retention;
    if (maxStoredBytes === undefined) return;
    if (bytes > maxStoredBytes) {
      throw new Error(`it takes ${bytes} bytes stored, over maxStoredBytes (${maxStoredBytes})`);
    }
    this.forget(key);
    this.kept.set(key, { bytes, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.keptBytes += bytes;
    if (this.keptBytes <= maxStoredBytes) return;
    const now = Date.now();
    for (const [expired, { expiresAt }] of this.kept) if (expiresAt <= now) this.forget(expired);
    const dropped: string[] = [];
    let remaining = this.keptBytes;
    for (const [oldest, entry] of this.kept) {
      if (remaining <= maxStoredBytes) break;
      dropped.push(oldest);
      remaining -= entry.bytes;
    }
    if (dropped.length === 0) return;
    try {
      await this.storage.mdelete(dropped);
    } catch (error) {
      this.forget(key);
      throw error;
    }
    for (const oldest of dropped) this.forget(oldest);
  }

  /** Marks the answer under `key` as just read: last to be dropped, and with `slidingTtl` its TTL started again. */
  private async touch(key: string): Promise<void> {
    const entry = this.kept.get(key);
    if (entry) {
      this.kept.delete(key);
      this.kept.set(
        key,
        this.retention.slidingTtl ? { ...entry, expiresAt: Date.now() + this.ttlSeconds * 1000 } : entry,
      );
    }
    if (!this.retention.slidingTtl) return;
    // The answer was read; a TTL not renewed keeps its first expiry
    await this.storage.expire(key, this.ttlSeconds).catch(() => false);
  }

  private forget(key: string): void {
    const entry = this.kept.get(key);
    if (!entry) return;
    this.kept.delete(key);
    this.keptBytes -= entry.bytes;
  }

  async onShutdown(): Promise<void> {
    await this.storage.disconnect();
  }
}

const foldingStoresByScope = new WeakMap<object, Set<ResultHandleStore>>();

/** Records that `store` folded an answer in `scope`, whose one listed `result_query` may belong to another app's copy. */
export function addFoldingStore(scope: object, store: ResultHandleStore): void {
  const stores = foldingStoresByScope.get(scope) ?? new Set<ResultHandleStore>();
  foldingStoresByScope.set(scope, stores.add(store));
}

/** The stores of every copy of the plugin that folded an answer in `scope`. */
export function foldingStoresOf(scope: object): ReadonlySet<ResultHandleStore> {
  return foldingStoresByScope.get(scope) ?? new Set<ResultHandleStore>();
}
