/**
 * Session Cryptographic Utilities
 *
 * Provides HMAC signing and verification for stored session data.
 * Protects against session data tampering when stored in external
 * systems like Redis that don't provide application-level integrity.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { StoredSession } from './transport-session.types';

/**
 * Signed session wrapper structure.
 * Contains the session data and its HMAC signature.
 */
export interface SignedSession {
  /** The session data */
  data: StoredSession;
  /** HMAC-SHA256 signature in base64url format */
  sig: string;
  /** Signature version for future algorithm changes */
  v: 1;
}

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
      throw new Error(
        '[SessionCrypto] MCP_SESSION_SECRET is required in production for session signing. ' +
          'Set this environment variable to a secure random string.',
      );
    }
    // In development, warn but allow using a default
    console.warn('[SessionCrypto] MCP_SESSION_SECRET not set. Using insecure default for development only.');
    return 'insecure-dev-secret-do-not-use-in-production';
  }

  return secret;
}

/**
 * Compute HMAC-SHA256 signature for session data.
 */
function computeSignature(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64url');
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
  const secret = getSigningSecret(config);
  const data = JSON.stringify(session);
  const sig = computeSignature(data, secret);

  const signed: SignedSession = {
    data: session,
    sig,
    v: 1,
  };

  return JSON.stringify(signed);
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
  try {
    const secret = getSigningSecret(config);
    const parsed = JSON.parse(signedData) as unknown;

    // Check if this is a signed session (has 'sig' field)
    if (!parsed || typeof parsed !== 'object' || !('sig' in parsed)) {
      // Not a signed session - could be legacy data
      // Return null to indicate verification failed
      return null;
    }

    const signed = parsed as SignedSession;

    // Verify version
    if (signed.v !== 1) {
      console.warn('[SessionCrypto] Unknown signature version:', signed.v);
      return null;
    }

    // Recompute signature from data
    const data = JSON.stringify(signed.data);
    const expectedSig = computeSignature(data, secret);

    // Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signed.sig, 'base64url');
    const expectedBuffer = Buffer.from(expectedSig, 'base64url');

    if (sigBuffer.length !== expectedBuffer.length) {
      console.warn('[SessionCrypto] Signature length mismatch - possible tampering');
      return null;
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      console.warn('[SessionCrypto] HMAC verification failed - session data may be tampered');
      return null;
    }

    return signed.data;
  } catch (error) {
    console.warn('[SessionCrypto] Failed to verify session:', (error as Error).message);
    return null;
  }
}

/**
 * Check if a stored value is a signed session.
 * Useful for migrating from unsigned to signed sessions.
 *
 * @param data - Raw data from storage
 * @returns true if the data appears to be a signed session
 */
export function isSignedSession(data: string): boolean {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' && 'sig' in parsed && 'v' in parsed;
  } catch {
    return false;
  }
}

/**
 * Verify or parse a session, supporting both signed and unsigned formats.
 * Useful for backwards compatibility during migration.
 *
 * @param data - Raw data from storage
 * @param config - Optional signing configuration
 * @returns The session (verified if signed, parsed if unsigned) or null
 */
export function verifyOrParseSession(data: string, config?: SessionSigningConfig): StoredSession | null {
  if (isSignedSession(data)) {
    return verifySession(data, config);
  }

  // Legacy unsigned session - parse without signature verification.
  // IMPORTANT: Caller MUST validate the result with storedSessionSchema.safeParse()
  // to ensure data integrity. See RedisSessionStore.get() for proper usage.
  try {
    return JSON.parse(data) as StoredSession;
  } catch {
    return null;
  }
}
