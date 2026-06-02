/**
 * SecureStoreBackend — the pluggable backing contract for the general
 * session-scoped secure-secret store (#470).
 *
 * Unlike {@link SessionCredentialVault} (which is OAuth-credential-centric:
 * `sub`-keyed, vault-rotation on every authorize, resume-URL `requireConnect`),
 * this is a GENERAL key→secret store for arbitrary user-typed secrets that a
 * tool or auth-UI reads/writes through `this.secureStore`. The backing is
 * selectable per deployment (memory / sqlite / redis / a custom — e.g.
 * OS-keychain — backend) WITHOUT the framework bundling any native dependency.
 *
 * Security model
 * --------------
 * - Every value is namespaced by a `ScopeRef` ({@link SecureStoreScopeRef}) so a
 *   `user`-scoped secret keys by the authenticated `sub`, a `session`-scoped one
 *   by the transport `sessionId`, and a `global`-scoped one by a fixed
 *   namespace. The accessor (`this.secureStore`) resolves the namespace from the
 *   request before calling a backend, so a backend NEVER sees raw identities it
 *   has not been handed.
 * - Built-in backends encrypt values at rest with the shared
 *   {@link VaultEncryption} primitive (AES-256-GCM, HKDF-SHA256 keyed by the
 *   namespace + a server pepper). A CUSTOM backend (e.g. an OS keychain) owns
 *   its own at-rest protection — the OS keychain is encrypted by the OS, so the
 *   keychain backend stores the plaintext value and relies on the OS for
 *   confidentiality.
 *
 * A backend deals ONLY in `(namespace, key) → string` — JSON serialization of
 * typed values is handled one layer up by the accessor.
 */

/**
 * The resolved namespace a {@link SecureStoreBackend} operates within. Produced
 * by the accessor from the current request + configured scope, NEVER by the
 * backend itself. Carries the scope kind purely for diagnostics/logging; a
 * backend keys solely on {@link namespace}.
 */
export interface SecureStoreScopeRef {
  /** The resolved namespace (already incorporates the scope + identity). */
  namespace: string;
  /** Which scope produced this namespace (for diagnostics only). */
  scope: SecureStoreScope;
}

/**
 * How a secure-store namespace is derived from the current request:
 * - `user` (default): keyed by the authenticated subject (`sub`). Survives a
 *   reconnect for the same user.
 * - `session`: keyed by the transport `sessionId`. Disappears when the session
 *   ends.
 * - `global`: a single shared namespace (server-wide). Use for operator-level
 *   secrets that are not tied to any one user/session.
 */
export type SecureStoreScope = 'user' | 'session' | 'global';

/**
 * Pluggable backing for the session-scoped secure-secret store.
 *
 * Implement this to provide a custom backing (e.g. an OS keychain) and wire it
 * via `auth.secureStore: { backend: myBackend }`. All four methods operate
 * within an explicit, already-resolved `namespace` so the same backend instance
 * can safely serve every scope/identity.
 */
export interface SecureStoreBackend {
  /**
   * Read a stored value by key within `namespace`. Returns `null` when the key
   * is absent (mirrors `StorageAdapter.get`).
   */
  get(namespace: string, key: string): Promise<string | null>;

  /**
   * Store `value` under `key` within `namespace`. `ttlMs` (when supported by
   * the backend) bounds the lifetime; backends that cannot honor a TTL (e.g. an
   * OS keychain) MUST ignore it rather than reject the write.
   */
  set(namespace: string, key: string, value: string, ttlMs?: number): Promise<void>;

  /**
   * Delete `key` within `namespace`. Returns `true` when a value existed and was
   * removed, `false` otherwise. Idempotent.
   */
  delete(namespace: string, key: string): Promise<boolean>;

  /**
   * List the keys present within `namespace`. Returns an empty array when the
   * namespace is empty.
   */
  list(namespace: string): Promise<string[]>;

  /**
   * Optional lifecycle hook. Backends that own a connection/handle (e.g. a
   * keychain session) may close it here. The built-in adapter-backed backend
   * does NOT dispose the shared adapter (it is owned by the auth layer).
   */
  dispose?(): Promise<void>;
}
