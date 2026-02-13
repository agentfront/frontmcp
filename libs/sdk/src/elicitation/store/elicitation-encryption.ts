/**
 * Elicitation Store Encryption
 *
 * Session-based encryption for elicitation store data.
 * Uses HKDF-SHA256 for key derivation and AES-256-GCM for encryption.
 *
 * Security Model:
 * - Each session gets a unique encryption key derived from sessionId + server secret
 * - Only requests with the actual sessionId can decrypt the elicitation data
 * - Zero-knowledge: Server storage contains only encrypted blobs
 *
 * @module elicitation/store/elicitation-encryption
 */

import {
  hkdfSha256,
  encryptAesGcm,
  decryptAesGcm,
  randomBytes,
  base64urlEncode,
  base64urlDecode,
  type EncBlob,
} from '@frontmcp/utils';
import { ElicitationSecretRequiredError } from '../../errors/auth-internal.errors';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypted blob structure for elicitation storage.
 * Re-exports EncBlob from @frontmcp/utils for consistency.
 */
export type ElicitationEncryptedBlob = EncBlob;

/**
 * Configuration for elicitation encryption.
 */
export interface ElicitationEncryptionConfig {
  /**
   * Whether encryption is enabled.
   * @default true in production, false in development
   */
  enabled: boolean;

  /**
   * Server secret for key derivation.
   * Falls back to MCP_ELICITATION_SECRET or MCP_SESSION_SECRET env vars.
   */
  secret?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Salt for HKDF key derivation (versioned for future migrations) */
const ELICITATION_SALT = 'elicitation-store-v1';

/** Text encoder for string to Uint8Array conversion */
const textEncoder = new TextEncoder();

/** Text decoder for Uint8Array to string conversion */
const textDecoder = new TextDecoder();

// ─────────────────────────────────────────────────────────────────────────────
// Secret Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the base secret for elicitation encryption.
 * Checks environment variables in order of specificity.
 *
 * @returns The secret string, or null if not configured
 */
export function getElicitationSecret(): string | null {
  return (
    process.env['MCP_ELICITATION_SECRET'] ||
    process.env['MCP_SESSION_SECRET'] ||
    process.env['MCP_SERVER_SECRET'] ||
    null
  );
}

/**
 * Check if elicitation encryption is available.
 * Returns true if a secret is configured via environment variables.
 */
export function isElicitationEncryptionAvailable(): boolean {
  return getElicitationSecret() !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a session-specific encryption key using HKDF-SHA256.
 *
 * Key derivation:
 * - IKM (Input Key Material): serverSecret + sessionId
 * - Salt: "elicitation-store-v1"
 * - Info: "elicit:{sessionId}"
 * - Output: 32-byte (256-bit) key for AES-256-GCM
 *
 * This ensures each session gets a unique key that:
 * 1. Cannot be derived without knowing the server secret
 * 2. Is deterministic for a given sessionId (same key on all nodes)
 * 3. Is cryptographically isolated from other sessions
 *
 * @param sessionId - The session ID to derive a key for
 * @param secret - Optional secret override (defaults to env var)
 * @returns 32-byte encryption key
 * @throws ElicitationSecretRequiredError if no secret is available
 */
export async function deriveElicitationKey(sessionId: string, secret?: string): Promise<Uint8Array> {
  const serverSecret = secret ?? getElicitationSecret();

  if (!serverSecret) {
    throw new ElicitationSecretRequiredError();
  }

  // Build IKM: serverSecret + sessionId
  const ikm = textEncoder.encode(serverSecret + sessionId);

  // Build salt and info
  const salt = textEncoder.encode(ELICITATION_SALT);
  const info = textEncoder.encode(`elicit:${sessionId}`);

  // Derive 32-byte key for AES-256
  return hkdfSha256(ikm, salt, info, 32);
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption / Decryption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt elicitation data using session-derived key.
 *
 * Uses AES-256-GCM for authenticated encryption:
 * - 12-byte random IV
 * - 16-byte authentication tag
 * - Ciphertext
 *
 * @param data - Data to encrypt (will be JSON serialized)
 * @param sessionId - Session ID for key derivation
 * @param secret - Optional secret override
 * @returns Encrypted blob
 */
export async function encryptElicitationData<T>(
  data: T,
  sessionId: string,
  secret?: string,
): Promise<ElicitationEncryptedBlob> {
  const key = await deriveElicitationKey(sessionId, secret);
  const plaintext = textEncoder.encode(JSON.stringify(data));
  const iv = randomBytes(12);

  const { ciphertext, tag } = encryptAesGcm(key, plaintext, iv);

  return {
    alg: 'A256GCM',
    iv: base64urlEncode(iv),
    tag: base64urlEncode(tag),
    data: base64urlEncode(ciphertext),
  };
}

/**
 * Decrypt elicitation data using session-derived key.
 *
 * @param blob - Encrypted blob to decrypt
 * @param sessionId - Session ID for key derivation
 * @param secret - Optional secret override
 * @returns Decrypted and parsed value, or null if decryption fails
 */
export async function decryptElicitationData<T>(
  blob: ElicitationEncryptedBlob,
  sessionId: string,
  secret?: string,
): Promise<T | null> {
  try {
    const key = await deriveElicitationKey(sessionId, secret);

    const iv = base64urlDecode(blob.iv);
    const tag = base64urlDecode(blob.tag);
    const ciphertext = base64urlDecode(blob.data);

    const decrypted = decryptAesGcm(key, ciphertext, iv, tag);

    return JSON.parse(textDecoder.decode(decrypted)) as T;
  } catch {
    // Decryption failed - wrong key, corrupted data, or tampered
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize encrypted blob to a string for storage.
 */
export function serializeElicitationBlob(blob: ElicitationEncryptedBlob): string {
  return JSON.stringify(blob);
}

/**
 * Deserialize a string back to encrypted blob.
 * Returns null if the string is not a valid encrypted blob.
 */
export function deserializeElicitationBlob(str: string): ElicitationEncryptedBlob | null {
  try {
    const parsed = JSON.parse(str);
    if (isEncryptedBlob(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a value is an encrypted blob.
 * Used for migration: detecting encrypted vs. plaintext data.
 */
export function isEncryptedBlob(value: unknown): value is ElicitationEncryptedBlob {
  return (
    value !== null &&
    typeof value === 'object' &&
    'alg' in value &&
    value.alg === 'A256GCM' &&
    'iv' in value &&
    typeof value.iv === 'string' &&
    'tag' in value &&
    typeof value.tag === 'string' &&
    'data' in value &&
    typeof value.data === 'string'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt and serialize in one step.
 *
 * @param data - Data to encrypt
 * @param sessionId - Session ID for key derivation
 * @param secret - Optional secret override
 * @returns Serialized encrypted blob string
 */
export async function encryptAndSerialize<T>(data: T, sessionId: string, secret?: string): Promise<string> {
  const blob = await encryptElicitationData(data, sessionId, secret);
  return serializeElicitationBlob(blob);
}

/**
 * Deserialize and decrypt in one step.
 *
 * @param str - Serialized encrypted blob string
 * @param sessionId - Session ID for key derivation
 * @param secret - Optional secret override
 * @returns Decrypted value, or null if decryption fails
 */
export async function deserializeAndDecrypt<T>(str: string, sessionId: string, secret?: string): Promise<T | null> {
  const blob = deserializeElicitationBlob(str);
  if (!blob) {
    return null;
  }
  return decryptElicitationData<T>(blob, sessionId, secret);
}

/**
 * Try to decrypt stored data.
 *
 * Similar to deserializeAndDecrypt but accepts parsed value directly.
 * Useful when the storage layer already parsed the JSON.
 *
 * @param value - Stored value (must be encrypted blob)
 * @param sessionId - Session ID for key derivation
 * @param secret - Optional secret override
 * @returns Decrypted value, or null if not encrypted or decryption fails
 */
export async function tryDecryptStoredValue<T>(value: unknown, sessionId: string, secret?: string): Promise<T | null> {
  if (!isEncryptedBlob(value)) {
    return null;
  }
  return decryptElicitationData<T>(value, sessionId, secret);
}
