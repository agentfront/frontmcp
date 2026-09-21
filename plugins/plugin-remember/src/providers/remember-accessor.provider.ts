import { FrontMcpContext, Provider, ProviderScope, type FrontMcpLogger } from '@frontmcp/sdk';

import { deserializeAndDecrypt, encryptAndSerialize, getKeySourceForScope } from '../remember.crypto';
import { RememberIdentityError } from '../remember.errors';
import { scheduleLegacyRememberPurge } from '../remember.legacy-purge';
import type {
  RememberEntry,
  RememberForgetOptions,
  RememberGetOptions,
  RememberKnowsOptions,
  RememberListOptions,
  RememberPluginOptions,
  RememberScope,
  RememberSetOptions,
} from '../remember.types';
import type { RememberStoreInterface } from './remember-store.interface';

/** Session id the stateless HTTP transport injects into every request. */
const STATELESS_SESSION_ID = '__stateless__';

/**
 * Layout version for the scopes whose storage location changed in the GHSA-h6f4-jg8x-38gj and
 * GHSA-225p-f8jh-f3rh fixes.
 *
 * Without it, a pre-fix `remember:session:<id>:<key>` and a post-fix key share a namespace, so
 * the one-time purge of unreadable entries could not tell them apart and would delete live
 * data. `global` is not versioned: neither its keys nor its key derivation changed.
 */
const STORAGE_LAYOUT_VERSION = 'v2';

/**
 * Make a namespace component unambiguous before it is joined with `:`.
 *
 * `encodeURIComponent` escapes the separator, so no combination of identity and key can
 * produce another pair's storage key.
 */
function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Context-scoped accessor for remember storage.
 * Provides a human-friendly API for storing and retrieving values.
 *
 * @example
 * ```typescript
 * const remember = this.get(RememberAccessorToken);
 *
 * // Store a value
 * await remember.set('theme', 'dark');
 *
 * // Retrieve a value
 * const theme = await remember.get('theme', { defaultValue: 'light' });
 *
 * // Store with scope and TTL
 * await remember.set('token', 'xyz', { scope: 'session', ttl: 300 });
 *
 * // Check if remembered
 * if (await remember.knows('onboarded')) { ... }
 *
 * // Forget something
 * await remember.forget('token');
 * ```
 */
@Provider({
  name: 'provider:remember:accessor',
  description: 'Context-scoped accessor for RememberPlugin storage',
  scope: ProviderScope.CONTEXT,
})
export class RememberAccessor {
  private readonly store: RememberStoreInterface;
  private readonly ctx: FrontMcpContext;
  private readonly config: RememberPluginOptions;
  private readonly keyPrefix: string;
  private readonly encryptionEnabled: boolean;

  constructor(
    store: RememberStoreInterface,
    ctx: FrontMcpContext,
    config: RememberPluginOptions,
    logger?: Pick<FrontMcpLogger, 'warn' | 'debug'>,
  ) {
    this.store = store;
    this.ctx = ctx;
    this.config = config;
    this.keyPrefix = config.keyPrefix ?? 'remember:';
    this.encryptionEnabled = config.encryption?.enabled !== false;

    // Armed here rather than at startup because `DynamicPlugin` exposes no startup hook and
    // providers are not eagerly instantiated. Scheduling only — the sweep itself runs later,
    // on a timer, so no request ever waits for it.
    if (!config.skipLegacyPurge) {
      scheduleLegacyRememberPurge(store, this.keyPrefix, { delayMs: config.legacyPurgeDelayMs, logger });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Store a value in memory.
   *
   * @param key - The key to store under
   * @param value - The value to store (any JSON-serializable data)
   * @param options - Storage options (scope, ttl, brand, metadata)
   */
  async set<T>(key: string, value: T, options: RememberSetOptions = {}): Promise<void> {
    const scope = options.scope ?? 'session';
    const storageKey = this.buildStorageKey(key, scope);

    const entry: RememberEntry<T> = {
      value,
      brand: options.brand,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: options.ttl ? Date.now() + options.ttl * 1000 : undefined,
      metadata: options.metadata,
    };

    const serialized = this.encryptionEnabled
      ? await encryptAndSerialize(entry, this.getKeySource(scope))
      : JSON.stringify(entry);

    await this.store.setValue(storageKey, serialized, options.ttl);
  }

  /**
   * Retrieve a value from memory.
   *
   * @param key - The key to retrieve
   * @param options - Retrieval options (scope, defaultValue)
   * @returns The stored value or defaultValue if not found
   */
  async get<T>(key: string, options: RememberGetOptions<T> = {}): Promise<T | undefined> {
    const scope = options.scope ?? 'session';
    const storageKey = this.buildStorageKey(key, scope);

    const raw = await this.store.getValue<string>(storageKey);
    if (!raw) return options.defaultValue;

    const entry = this.encryptionEnabled
      ? await deserializeAndDecrypt<RememberEntry<T>>(raw, this.getKeySource(scope))
      : this.parseEntry<T>(raw);

    if (!entry) return options.defaultValue;

    // Check if entry has expired (double-check beyond storage TTL)
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      await this.forget(key, { scope });
      return options.defaultValue;
    }

    return entry.value;
  }

  /**
   * Get the full entry including metadata.
   *
   * @param key - The key to retrieve
   * @param options - Retrieval options (scope)
   * @returns The full entry or undefined if not found
   */
  async getEntry<T>(key: string, options: { scope?: RememberScope } = {}): Promise<RememberEntry<T> | undefined> {
    const scope = options.scope ?? 'session';
    const storageKey = this.buildStorageKey(key, scope);

    const raw = await this.store.getValue<string>(storageKey);
    if (!raw) return undefined;

    const entry = this.encryptionEnabled
      ? await deserializeAndDecrypt<RememberEntry<T>>(raw, this.getKeySource(scope))
      : this.parseEntry<T>(raw);

    if (!entry) return undefined;

    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      await this.forget(key, { scope });
      return undefined;
    }

    return entry;
  }

  /**
   * Forget (delete) a value from memory.
   *
   * @param key - The key to forget
   * @param options - Options (scope)
   */
  async forget(key: string, options: RememberForgetOptions = {}): Promise<void> {
    const scope = options.scope ?? 'session';
    const storageKey = this.buildStorageKey(key, scope);
    await this.store.delete(storageKey);
  }

  /**
   * Check if a key is remembered (exists and not expired).
   *
   * @param key - The key to check
   * @param options - Options (scope)
   * @returns true if the key exists
   */
  async knows(key: string, options: RememberKnowsOptions = {}): Promise<boolean> {
    const scope = options.scope ?? 'session';
    const storageKey = this.buildStorageKey(key, scope);
    return this.store.exists(storageKey);
  }

  /**
   * List all remembered keys for a scope.
   *
   * @param options - Options (scope, pattern)
   * @returns Array of keys (without the scope prefix)
   */
  async list(options: RememberListOptions = {}): Promise<string[]> {
    const scope = options.scope ?? 'session';
    const scopePrefix = this.buildScopePrefix(scope);
    const fullPattern = scopePrefix + (options.pattern ?? '*');

    const keys = await this.store.keys(fullPattern);

    // Strip the scope prefix from returned keys
    return keys.map((k) => k.slice(scopePrefix.length));
  }

  /**
   * Update an existing entry's value while preserving metadata.
   *
   * @param key - The key to update
   * @param value - The new value
   * @param options - Options (scope, ttl)
   */
  async update<T>(key: string, value: T, options: { scope?: RememberScope; ttl?: number } = {}): Promise<boolean> {
    const scope = options.scope ?? 'session';
    const existing = await this.getEntry<T>(key, { scope });

    if (!existing) return false;

    const entry: RememberEntry<T> = {
      ...existing,
      value,
      updatedAt: Date.now(),
      expiresAt: options.ttl ? Date.now() + options.ttl * 1000 : existing.expiresAt,
    };

    const storageKey = this.buildStorageKey(key, scope);
    const serialized = this.encryptionEnabled
      ? await encryptAndSerialize(entry, this.getKeySource(scope))
      : JSON.stringify(entry);

    await this.store.setValue(storageKey, serialized, options.ttl);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Convenience Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the session ID from context.
   */
  get sessionId(): string {
    return this.ctx.sessionId;
  }

  /**
   * Get the user ID from context (if available).
   */
  get userId(): string | undefined {
    // Try to get userId from various auth info fields
    const authInfo = this.ctx.authInfo;
    return (
      (authInfo?.extra?.['userId'] as string | undefined) ??
      (authInfo?.extra?.['sub'] as string | undefined) ??
      authInfo?.clientId ??
      undefined
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build the full storage key including scope prefix.
   */
  private buildStorageKey(key: string, scope: RememberScope): string {
    return this.buildScopePrefix(scope) + key;
  }

  /**
   * The identity that namespaces session- and tool-scoped storage
   * (GHSA-225p-f8jh-f3rh).
   *
   * In stateless mode the transport injects the literal session id `__stateless__` into every
   * request, so using it as a namespace put every client's memory under the same keys. A
   * stateless request carries no session identity: the authenticated principal is the only
   * per-client identity available, and where there is none the request has no business
   * reading or writing per-client memory at all.
   */
  private resolveSessionIdentity(): string {
    const sessionId = this.ctx.sessionId;

    if (sessionId !== STATELESS_SESSION_ID) {
      return sessionId;
    }

    const userId = this.userId;
    if (userId) {
      return `stateless-user:${userId}`;
    }

    throw new RememberIdentityError(
      'Remember cannot use session or tool scope for an unauthenticated stateless request: ' +
        'every such request shares the session id "__stateless__", so the data would be shared ' +
        'across all clients. Authenticate the request, use a stateful transport, or choose ' +
        "the 'global' scope if the data really is shared.",
    );
  }

  /**
   * Build the scope-specific prefix.
   *
   * Every variable component is encoded, because the separator is also a legal character in
   * a user id, a tool name and a memory key. Left raw, identity `a` with key `b:c` produces
   * the same storage key as identity `a:b` with key `c` — one client reading or overwriting
   * another's value through nothing more exotic than a colon in a name.
   */
  private buildScopePrefix(scope: RememberScope): string {
    switch (scope) {
      case 'session':
        return `${this.keyPrefix}${STORAGE_LAYOUT_VERSION}:session:${encodeKeyPart(this.resolveSessionIdentity())}:`;
      case 'user': {
        const userId = this.userId;
        if (!userId) {
          // 'anonymous' pooled every unauthenticated caller into one namespace, which is the
          // same cross-client disclosure as the stateless case above.
          throw new RememberIdentityError(
            'Remember cannot use user scope without an authenticated user: all unauthenticated ' +
              "callers would share one namespace. Authenticate the request or use the 'global' scope.",
          );
        }
        return `${this.keyPrefix}${STORAGE_LAYOUT_VERSION}:user:${encodeKeyPart(userId)}:`;
      }
      case 'tool': {
        // Tool scope uses flow name if available
        const toolName = this.ctx.flow?.name ?? 'unknown';
        return (
          `${this.keyPrefix}${STORAGE_LAYOUT_VERSION}:tool:` +
          `${encodeKeyPart(toolName)}:${encodeKeyPart(this.resolveSessionIdentity())}:`
        );
      }
      case 'global':
        return `${this.keyPrefix}global:`;
    }
  }

  /**
   * Get the encryption key source for a scope.
   */
  private getKeySource(scope: RememberScope) {
    // Must match the namespace: a key derived from the raw '__stateless__' id would be the
    // same constant for every client, exactly as the storage key was.
    const needsSessionIdentity = scope === 'session' || scope === 'tool';

    return getKeySourceForScope(scope, {
      sessionId: needsSessionIdentity ? this.resolveSessionIdentity() : this.ctx.sessionId,
      userId: this.userId,
      toolName: this.ctx.flow?.name,
    });
  }

  /**
   * Parse a JSON entry (when encryption is disabled).
   */
  private parseEntry<T>(raw: string): RememberEntry<T> | null {
    try {
      return JSON.parse(raw) as RememberEntry<T>;
    } catch {
      return null;
    }
  }
}

/**
 * Factory function for creating RememberAccessor instances.
 * Used by the plugin's dynamicProviders.
 */
export function createRememberAccessor(
  store: RememberStoreInterface,
  ctx: FrontMcpContext,
  config: RememberPluginOptions,
  logger?: Pick<FrontMcpLogger, 'warn' | 'debug'>,
): RememberAccessor {
  return new RememberAccessor(store, ctx, config, logger);
}
