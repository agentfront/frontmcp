/**
 * SecureStoreAccessorImpl — request-scoped implementation of the
 * `this.secureStore` accessor (#470).
 *
 * Binds a {@link SecureStoreBackend} to the current request's resolved scope
 * namespace and handles JSON (de)serialization of typed values. The namespace
 * is derived from the configured {@link SecureStoreScope}:
 * - `user`: the authenticated `sub` (resolved lazily via `resolveSub`),
 * - `session`: the transport `sessionId` (resolved via `resolveSessionId`),
 * - `global`: a single fixed server-wide namespace.
 *
 * Identities are hashed into the namespace (never stored raw) so storage keys
 * carry no PII, and so the backend cannot correlate the raw subject/session.
 */

import { sha256Hex } from '@frontmcp/utils';

import { noopAuthLogger, type AuthLogger } from '../common/auth-logger.interface';
import { type SecureStoreBackend, type SecureStoreScope } from './secure-store';
import { type SecureStoreAccessor, type SecureStoreSetOptions } from './secure-store-accessor';

/** Fixed namespace used for `global` scope (server-wide secrets). */
const GLOBAL_NAMESPACE = 'global';

/**
 * Dependencies for {@link SecureStoreAccessorImpl}.
 */
export interface SecureStoreAccessorDeps {
  /** The secure-store backing (built-in encrypted-storage, or a custom one). */
  backend: SecureStoreBackend;
  /** Configured scope strategy. @default 'user' */
  scope?: SecureStoreScope;
  /**
   * Resolve the current request's authenticated subject. Returns undefined for
   * anonymous/unauthenticated requests (so `user` scope is unavailable then).
   */
  resolveSub: () => string | undefined;
  /**
   * Resolve the current request's transport session id. Returns undefined when
   * there is no session (so `session` scope is unavailable then).
   */
  resolveSessionId: () => string | undefined;
  /** Default TTL (ms) applied to writes when `set` omits one. */
  ttlMs?: number;
  /** Scoped logger. */
  logger?: AuthLogger;
}

export class SecureStoreAccessorImpl implements SecureStoreAccessor {
  private readonly backend: SecureStoreBackend;
  private readonly scope: SecureStoreScope;
  private readonly resolveSub: () => string | undefined;
  private readonly resolveSessionId: () => string | undefined;
  private readonly ttlMs?: number;
  private readonly logger: AuthLogger;

  constructor(deps: SecureStoreAccessorDeps) {
    this.backend = deps.backend;
    this.scope = deps.scope ?? 'user';
    this.resolveSub = deps.resolveSub;
    this.resolveSessionId = deps.resolveSessionId;
    this.ttlMs = deps.ttlMs;
    this.logger = deps.logger ?? noopAuthLogger;
  }

  /**
   * Resolve the namespace for the current request from the configured scope.
   * Returns undefined when the scope's identity is unavailable (anonymous user
   * under `user` scope, or no session under `session` scope), in which case
   * reads return empty and writes are skipped.
   */
  private resolveNamespace(): string | undefined {
    switch (this.scope) {
      case 'global':
        return GLOBAL_NAMESPACE;
      case 'session': {
        const sid = this.resolveSessionId();
        return sid ? `s:${sha256Hex(sid).slice(0, 32)}` : undefined;
      }
      case 'user':
      default: {
        const sub = this.resolveSub();
        return sub ? `u:${sha256Hex(sub).slice(0, 32)}` : undefined;
      }
    }
  }

  async get<T = string>(key: string): Promise<T | undefined> {
    const namespace = this.resolveNamespace();
    if (!namespace) return undefined;
    const raw = await this.backend.get(namespace, key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`SecureStore: failed to parse secret "${key}": ${errMsg(err)}`);
      return undefined;
    }
  }

  async set<T = string>(key: string, value: T, options?: SecureStoreSetOptions): Promise<void> {
    const namespace = this.resolveNamespace();
    if (!namespace) {
      this.logger.debug(`SecureStore: no ${this.scope} scope for request; skipping set("${key}")`);
      return;
    }
    const ttlMs = options?.ttlMs ?? this.ttlMs;
    await this.backend.set(namespace, key, JSON.stringify(value), ttlMs);
  }

  async delete(key: string): Promise<boolean> {
    const namespace = this.resolveNamespace();
    if (!namespace) return false;
    return this.backend.delete(namespace, key);
  }

  async list(): Promise<string[]> {
    const namespace = this.resolveNamespace();
    if (!namespace) return [];
    return this.backend.list(namespace);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
