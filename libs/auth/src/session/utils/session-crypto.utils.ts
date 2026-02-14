// session/utils/session-crypto.utils.ts
//
// Core session encryption/decryption utilities extracted from SDK's session-id.utils.ts.
// These are pure crypto operations that don't depend on SDK framework primitives.

import { sha256, encryptValue, decryptValue } from '@frontmcp/utils';
import { getMachineId } from '../../machine-id/machine-id';
import { SessionSecretRequiredError } from '../../errors/auth-internal.errors';

// Cached encryption key (derived once per process)
let cachedKey: Uint8Array | null = null;

/**
 * Symmetric key derived from secret or machine id (stable for the process).
 * Uses getMachineId() from authorization module as single source of truth.
 *
 * SECURITY: In production, MCP_SESSION_SECRET is REQUIRED.
 * Falls back to getMachineId() only in development/test environments.
 *
 * @throws Error if MCP_SESSION_SECRET is not set in production
 */
export function getKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const secret = process.env['MCP_SESSION_SECRET'];
  const nodeEnv = process.env['NODE_ENV'];

  if (!secret) {
    // Fail fast in production - machine ID is not secure for production use
    if (nodeEnv === 'production') {
      throw new SessionSecretRequiredError('session ID encryption');
    }
    // Development/test fallback - log warning
    console.warn(
      '[SessionIdUtils] Using machine ID as session encryption secret - NOT SECURE FOR PRODUCTION. ' +
        'Set MCP_SESSION_SECRET environment variable for secure session encryption.',
    );
  }

  const base = secret || getMachineId();
  cachedKey = sha256(new TextEncoder().encode(base)); // 32 bytes
  return cachedKey;
}

/**
 * Encrypt an object to a compact session ID format (iv.tag.ct).
 */
export function encryptJson(obj: unknown): string {
  const key = getKey();
  const encrypted = encryptValue(obj, key);
  // Pack iv.tag.ct as base64url format (matches decryptValue expected input)
  return `${encrypted.iv}.${encrypted.tag}.${encrypted.data}`;
}

/**
 * Low-level decryption that returns the raw JSON payload or null.
 * Handles all crypto/parsing failures by returning null.
 */
export function decryptSessionJson(sessionId: string): unknown {
  const parts = sessionId.split('.');
  if (parts.length !== 3) return null;

  const [ivB64, tagB64, ctB64] = parts;
  if (!ivB64 || !tagB64 || !ctB64) return null;

  const key = getKey();
  return decryptValue({ alg: 'A256GCM', iv: ivB64, tag: tagB64, data: ctB64 }, key);
}

/**
 * Safe wrapper around decryptSessionJson that catches crypto/parse errors.
 */
export function safeDecrypt(sessionId: string): unknown {
  try {
    return decryptSessionJson(sessionId);
  } catch {
    return null;
  }
}

/**
 * Reset the cached key. Useful for testing.
 * @internal
 */
export function resetCachedKey(): void {
  cachedKey = null;
}
