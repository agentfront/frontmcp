/**
 * Cloudflare Workers KV storage adapter.
 *
 * Backs the generic {@link StorageAdapter} with a Cloudflare **KV namespace**
 * binding, so factory-based stores (sessions, elicitation, bundle cache, …) can
 * run on Workers via `{ type: 'cloudflare-kv', cloudflareKv: { namespace } }`.
 *
 * Cloudflare KV is an eventually-consistent key/value store, NOT Redis. Some
 * `StorageAdapter` operations have no faithful KV implementation and throw
 * {@link StorageNotSupportedError} rather than silently returning wrong data:
 *   - **Atomic counters** (`incr`/`decr`/`incrBy`): KV has no atomic increment;
 *     a get+put is racy under eventual consistency. Use a Durable Object for
 *     atomic state (the forthcoming `@frontmcp/adapters/cloudflare` DO host).
 *   - **Conditional writes** (`ifNotExists`/`ifExists`): KV has no compare-and-set.
 *   - **TTL introspection** (`ttl`): KV does not expose a key's remaining TTL.
 *
 * Other KV-specific constraints are honored: the minimum `expirationTtl` is
 * 60 seconds (a smaller TTL throws), `keys()` is implemented over the prefix-
 * scoped, paginated `list()` API with client-side glob filtering, and the
 * binding is treated as always-connected.
 */
import { StorageNotSupportedError, StorageOperationError } from '../errors';
import type { CloudflareKvAdapterOptions, CloudflareKvNamespace, SetOptions } from '../types';
import { matchesPattern } from '../utils/pattern';
import { validateTTL } from '../utils/ttl';
import { BaseStorageAdapter } from './base';

/** Cloudflare KV's documented minimum `expirationTtl` (seconds). */
const CF_KV_MIN_TTL_SECONDS = 60;

/** One page of a KV `list()` call (derived from the binding contract). */
type KvListResult = Awaited<ReturnType<CloudflareKvNamespace['list']>>;

/** The literal portion of a glob pattern up to the first `*`/`?` metacharacter. */
function literalPrefix(pattern: string): string {
  const star = pattern.indexOf('*');
  const q = pattern.indexOf('?');
  const idx = star === -1 ? q : q === -1 ? star : Math.min(star, q);
  return idx === -1 ? pattern : pattern.slice(0, idx);
}

export class CloudflareKvStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'cloudflare-kv';

  private readonly kv: CloudflareKvNamespace;
  private readonly keyPrefix: string;

  constructor(options: CloudflareKvAdapterOptions) {
    super();
    if (!options?.namespace) {
      throw new Error('CloudflareKvStorageAdapter: a bound KV `namespace` is required (resolve it from the Worker `env`).');
    }
    this.kv = options.namespace;
    this.keyPrefix = options.keyPrefix ?? '';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  // A KV binding is always available; "connection" is just a readiness flag.
  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async ping(): Promise<boolean> {
    try {
      await this.kv.list({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  // ── Core ───────────────────────────────────────────────────────────────
  async get(key: string): Promise<string | null> {
    this.ensureConnected();
    return this.kv.get(this.prefixKey(key), 'text');
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    if (options?.ifNotExists || options?.ifExists) {
      throw new StorageNotSupportedError(
        'conditional set (ifNotExists/ifExists)',
        this.backendName,
        'Cloudflare KV has no compare-and-set; use a Durable Object for atomic conditional writes.',
      );
    }
    const putOptions =
      options?.ttlSeconds !== undefined ? { expirationTtl: this.toExpirationTtl(options.ttlSeconds, key) } : undefined;
    await this.kv.put(this.prefixKey(key), value, putOptions);
  }

  async delete(key: string): Promise<boolean> {
    this.ensureConnected();
    const existed = await this.exists(key);
    await this.kv.delete(this.prefixKey(key));
    return existed;
  }

  async exists(key: string): Promise<boolean> {
    this.ensureConnected();
    return (await this.kv.get(this.prefixKey(key), 'text')) !== null;
  }

  // ── TTL ────────────────────────────────────────────────────────────────
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.ensureConnected();
    const ttl = this.toExpirationTtl(ttlSeconds, key);
    // KV can't update TTL in place — re-put the existing value with a new TTL.
    const value = await this.kv.get(this.prefixKey(key), 'text');
    if (value === null) return false;
    await this.kv.put(this.prefixKey(key), value, { expirationTtl: ttl });
    return true;
  }

  async ttl(_key: string): Promise<number | null> {
    throw new StorageNotSupportedError(
      'ttl',
      this.backendName,
      'Cloudflare KV does not expose a key\'s remaining TTL. Track expiry alongside the value if you need it.',
    );
  }

  // ── Enumeration ──────────────────────────────────────────────────────────
  async keys(pattern = '*'): Promise<string[]> {
    this.ensureConnected();
    const prefixedPattern = this.prefixKey(pattern);
    // KV list() is prefix-scoped + paginated; narrow with the pattern's literal
    // prefix, then glob-filter client-side.
    const listPrefix = literalPrefix(prefixedPattern);
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page: KvListResult = await this.kv.list({ prefix: listPrefix || undefined, cursor });
      for (const { name } of page.keys) {
        if (matchesPattern(name, prefixedPattern)) out.push(this.unprefixKey(name));
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
  }

  // ── Atomic (unsupported on KV) ───────────────────────────────────────────
  async incr(key: string): Promise<number> {
    return this.incrBy(key, 1);
  }

  async decr(key: string): Promise<number> {
    return this.incrBy(key, -1);
  }

  async incrBy(_key: string, _amount: number): Promise<number> {
    throw new StorageNotSupportedError(
      'incr/decr/incrBy',
      this.backendName,
      'Cloudflare KV has no atomic increment (a get+put is racy under eventual consistency). Use a Durable Object for atomic counters.',
    );
  }

  // ── Pub/Sub (unsupported) ────────────────────────────────────────────────
  protected override getPubSubSuggestion(): string {
    return 'Cloudflare KV does not support pub/sub. Use a Durable Object (or Queues) for fan-out.';
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  /** Validate + enforce KV's 60s minimum `expirationTtl`. */
  private toExpirationTtl(ttlSeconds: number, key: string): number {
    validateTTL(ttlSeconds);
    if (ttlSeconds < CF_KV_MIN_TTL_SECONDS) {
      throw new StorageOperationError(
        'set',
        key,
        `cloudflare-kv: expirationTtl must be >= ${CF_KV_MIN_TTL_SECONDS}s (Cloudflare KV minimum); got ${ttlSeconds}s.`,
      );
    }
    return ttlSeconds;
  }

  private prefixKey(key: string): string {
    return this.keyPrefix + key;
  }

  private unprefixKey(key: string): string {
    return this.keyPrefix && key.startsWith(this.keyPrefix) ? key.slice(this.keyPrefix.length) : key;
  }
}
