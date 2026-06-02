/**
 * SecureStoreAccessor — the `this.secureStore` ToolContext / auth-UI API (#470).
 *
 * A typed accessor over a {@link SecureStoreBackend} that tools (and the auth
 * UI) read/write user-typed secrets through, scoped to the current
 * session/subject. It owns scope resolution, JSON (de)serialization of typed
 * values, and TTLs — so server authors never re-implement crypto, key
 * derivation, scope, or persistence (the whole point of #470).
 *
 * This is the GENERAL secret store. It is distinct from `this.credentials`,
 * which remains the OAuth-credential-centric vault (`requireConnect` resume
 * URLs, per-authorize vault rotation). #464's `this.credentials` is unchanged.
 */

import { type Token } from '@frontmcp/di';

/**
 * Runtime accessor for session-scoped secure secrets, available on tool
 * contexts (and the auth UI) as `this.secureStore`:
 *
 * ```typescript
 * @Tool({ name: 'call_api' })
 * class CallApiTool extends ToolContext {
 *   async execute(input: Input): Promise<Output> {
 *     await this.secureStore.set('stg.api-key', input.apiKey);
 *     const key = await this.secureStore.get<string>('stg.api-key');
 *     const all = await this.secureStore.list();
 *     // …
 *   }
 * }
 * ```
 *
 * Values are JSON-serialized, so any JSON-safe type round-trips. The namespace
 * is resolved from the configured `auth.secureStore.scope` (the authenticated
 * `sub` for `user`, the transport `sessionId` for `session`, or a fixed
 * server-wide namespace for `global`).
 */
export interface SecureStoreAccessor {
  /**
   * Read a secret by key for the current scope, JSON-parsed into `T`. Returns
   * `undefined` when the key is absent, when the scope cannot be resolved (e.g.
   * an anonymous request under `user` scope), or when decryption/parse fails.
   */
  get<T = string>(key: string): Promise<T | undefined>;

  /**
   * Store a JSON-serializable `value` under `key` for the current scope.
   * Optionally bounded by `ttlMs`. Resolves without writing (and logs at debug)
   * when the scope cannot be resolved for the current request.
   */
  set<T = string>(key: string, value: T, options?: SecureStoreSetOptions): Promise<void>;

  /**
   * Delete a secret by key for the current scope. Returns `true` when a value
   * existed and was removed; `false` otherwise (including when the scope cannot
   * be resolved).
   */
  delete(key: string): Promise<boolean>;

  /**
   * List the secret keys present for the current scope. Empty when the scope
   * cannot be resolved or when no secrets are stored.
   */
  list(): Promise<string[]>;
}

/**
 * Options for {@link SecureStoreAccessor.set}.
 */
export interface SecureStoreSetOptions {
  /**
   * Time-to-live in milliseconds. Backends that cannot honor a TTL (e.g. an OS
   * keychain) ignore it. Falls back to the configured `auth.secureStore.ttlMs`
   * when omitted.
   */
  ttlMs?: number;
}

/**
 * DI token for {@link SecureStoreAccessor}. Resolved by the `this.secureStore`
 * context extension.
 */
export const SECURE_STORE_ACCESSOR = Symbol.for('frontmcp:SECURE_STORE_ACCESSOR') as Token<SecureStoreAccessor>;
