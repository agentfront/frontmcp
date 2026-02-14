/**
 * Session Cryptographic Utilities
 *
 * Provides HMAC signing and verification for stored session data.
 * Protects against session data tampering when stored in external
 * systems like Redis that don't provide application-level integrity.
 *
 * This module wraps the generic @frontmcp/utils HMAC signing utilities
 * with session-specific types and environment-based secret handling.
 */

import {
  signData,
  verifyData,
  isSignedData,
  verifyOrParseData,
  type SignedData,
  type HmacSigningConfig,
} from '@frontmcp/utils';
import type { StoredSession } from './transport-session.types';
import { SessionSecretRequiredError } from '../errors/auth-internal.errors';

/**
 * Signed session wrapper structure.
 * Contains the session data and its HMAC signature.
 */
export type SignedSession = SignedData<StoredSession>;

/**
 * Configuration for session signing.
 */
export interface SessionSigningConfig {
  /**
   * The secret key used for HMAC signing.
   * Should be at least 32 bytes for security.
   * Uses MCP_SESSION_SECRET environment variable if not provided.
   */
  secret?: string;
}

/**
 * Get the signing secret from config or environment.
 * Throws if no secret is available in production.
 */
function getSigningSecret(config?: SessionSigningConfig): string {
  const secret = config?.secret || process.env['MCP_SESSION_SECRET'];

  if (!secret) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new SessionSecretRequiredError('session signing');
    }
    // In development, warn but allow using a default
    console.warn('[SessionCrypto] MCP_SESSION_SECRET not set. Using insecure default for development only.');
    return 'insecure-dev-secret-do-not-use-in-production';
  }

  return secret;
}

/**
 * Resolve config to HmacSigningConfig with secret.
 */
function resolveConfig(config?: SessionSigningConfig): HmacSigningConfig {
  return { secret: getSigningSecret(config) };
}

/**
 * Sign a stored session with HMAC-SHA256.
 *
 * Creates a tamper-evident wrapper around the session data.
 * Any modification to the session will invalidate the signature.
 *
 * @param session - The session to sign
 * @param config - Optional signing configuration
 * @returns JSON string containing signed session
 *
 * @example
 * ```typescript
 * const signed = signSession(session);
 * await redis.set(key, signed);
 * ```
 */
export function signSession(session: StoredSession, config?: SessionSigningConfig): string {
  return signData(session, resolveConfig(config));
}

/**
 * Verify and extract a signed session.
 *
 * Validates the HMAC signature and returns the session if valid.
 * Returns null if the signature is invalid or the data is corrupted.
 *
 * @param signedData - JSON string from signSession()
 * @param config - Optional signing configuration
 * @returns The verified session or null if invalid
 *
 * @example
 * ```typescript
 * const raw = await redis.get(key);
 * const session = verifySession(raw);
 * if (!session) {
 *   // Session was tampered with or corrupted
 *   await redis.del(key);
 * }
 * ```
 */
export function verifySession(signedData: string, config?: SessionSigningConfig): StoredSession | null {
  return verifyData<StoredSession>(signedData, resolveConfig(config));
}

/**
 * Check if a stored value is a signed session.
 * Useful for migrating from unsigned to signed sessions.
 *
 * @param data - Raw data from storage
 * @returns true if the data appears to be a signed session
 */
export { isSignedData as isSignedSession };

/**
 * Verify or parse a session, supporting both signed and unsigned formats.
 * Useful for backwards compatibility during migration.
 *
 * @param data - Raw data from storage
 * @param config - Optional signing configuration
 * @returns The session (verified if signed, parsed if unsigned) or null
 */
export function verifyOrParseSession(data: string, config?: SessionSigningConfig): StoredSession | null {
  return verifyOrParseData<StoredSession>(data, resolveConfig(config));
}
