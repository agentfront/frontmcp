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

/** Folded answers, encrypted under keys derived from their handle and owner, each readable by that owner until its TTL. */
export class ResultHandleStore implements OnShutdown {
  constructor(
    private readonly storage: NamespacedStorage,
    private readonly ttlSeconds: number,
  ) {}

  /** A new handle: a random UUID, which says nothing about the answer it will hold. */
  newHandle(): string {
    return randomUUID();
  }

  /** Keep `value` under `handle` for `owner` until the TTL runs out. */
  async save(handle: string, value: unknown, owner: ResultOwner): Promise<void> {
    const encrypted = encryptAndSerialize(value, deriveFromHandle('key', handle, owner));
    await this.storage.set(storageKeyOf(handle, owner), encrypted, { ttlSeconds: this.ttlSeconds });
  }

  /** The value under `handle`, or undefined when it expired, never existed, or `owner` is not its owner. */
  async read(handle: string, owner: ResultOwner): Promise<{ value: unknown } | undefined> {
    if (!HANDLE.test(handle)) return undefined;
    const stored = await this.storage.get(storageKeyOf(handle, owner));
    if (stored === null) return undefined;
    try {
      return { value: deserializeAndDecrypt(stored, deriveFromHandle('key', handle, owner)) };
    } catch {
      return undefined;
    }
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
