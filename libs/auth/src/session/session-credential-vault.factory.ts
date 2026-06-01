/**
 * SessionCredentialVault factory.
 *
 * Follows the CLAUDE.md storage-factory pattern: builds a connected
 * {@link StorageAdapter} from the SAME `auth.tokenStorage` config that backs the
 * authorization-code / token stores, then wraps it in a
 * {@link SessionCredentialVault}. Keeping one config source means a credential
 * vault is automatically persistent (Redis/SQLite) whenever the rest of the auth
 * layer is, and in-memory by default otherwise.
 */

import { type StorageAdapter } from '@frontmcp/utils';

import { type AuthLogger } from '../common/auth-logger.interface';
import { type TokenStorageConfig } from '../options/interfaces';
import { SessionCredentialVault } from './session-credential-vault';
import { createTokenStorageAdapter } from './token-storage.factory';

/**
 * Options for {@link createSessionCredentialVault}.
 */
export interface CreateSessionCredentialVaultOptions {
  /**
   * Token-storage config — the SAME `auth.tokenStorage` selection used by the
   * token stores. `'memory'` (or undefined) yields an in-memory vault;
   * `{ redis }` / `{ sqlite }` a persistent one.
   */
  tokenStorage?: TokenStorageConfig;
  /**
   * Optionally reuse an already-connected adapter instead of creating one from
   * `tokenStorage`. When provided, `tokenStorage` is ignored for adapter
   * construction (used to share the LocalPrimaryAuth adapter).
   */
  storage?: StorageAdapter;
  /** Master pepper override (defaults to `VAULT_SECRET ?? JWT_SECRET`). */
  pepper?: string;
  /** Key prefix for all stored keys. @default 'mcp:cred:' */
  keyPrefix?: string;
  /** TTL (ms) for credential entries. @default undefined (no expiry) */
  ttlMs?: number;
  /** Scoped logger. */
  logger?: AuthLogger;
}

/**
 * Create a {@link SessionCredentialVault} backed by the configured token storage.
 *
 * @returns the vault plus the backing adapter type, mirroring the SDK store
 *   factories (`{ store, type }`).
 */
export async function createSessionCredentialVault(
  options: CreateSessionCredentialVaultOptions,
): Promise<{ vault: SessionCredentialVault; type: 'memory' | 'redis' | 'sqlite' }> {
  const storage = options.storage ?? (await createTokenStorageAdapter(options.tokenStorage));

  const vault = new SessionCredentialVault({
    storage,
    pepper: options.pepper,
    keyPrefix: options.keyPrefix,
    ttlMs: options.ttlMs,
    logger: options.logger,
  });

  const type: 'memory' | 'redis' | 'sqlite' =
    options.tokenStorage === undefined || options.tokenStorage === 'memory'
      ? 'memory'
      : 'sqlite' in options.tokenStorage
        ? 'sqlite'
        : 'redis';

  return { vault, type };
}
