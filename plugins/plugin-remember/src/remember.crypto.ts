import {
  hkdfSha256,
  encryptAesGcm,
  decryptAesGcm,
  randomBytes,
  base64urlEncode,
  base64urlDecode,
} from '@frontmcp/utils';
import type { EncBlob } from '@frontmcp/utils';
import type { RememberScope } from './remember.types';
import { getOrCreatePersistedSecret } from './remember.secret-persistence';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypted blob structure for storage.
 * Re-exports EncBlob from @frontmcp/utils for consistency.
 */
export type EncryptedBlob = EncBlob;

/**
 * Key derivation source configuration.
 */
export type EncryptionKeySource =
  | { type: 'session'; sessionId: string }
  | { type: 'user'; userId: string }
  | { type: 'tool'; toolName: string; sessionId: string }
  | { type: 'global' }
  | { type: 'custom'; key: string };

// ─────────────────────────────────────────────────────────────────────────────
// Key Derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the base secret for key derivation (used for user/global scopes).
 * Tries environment variables, falls back to persisted secret.
 *
 * NOTE: This is async because it may need to load/generate a persisted secret.
 */
async function getBaseSecret(): Promise<string> {
  // Check environment variables first
  const envSecret =
    process.env['REMEMBER_SECRET'] || process.env['MCP_MEMORY_SECRET'] || process.env['MCP_SESSION_SECRET'];

  if (envSecret) {
    return envSecret;
  }

  // Fall back to persisted secret (will generate if needed)
  return getOrCreatePersistedSecret();
}

/** Text encoder for string to Uint8Array conversion */
const textEncoder = new TextEncoder();

/**
 * Derive a 256-bit encryption key based on the source.
 * Uses HKDF-SHA256 from @frontmcp/utils.
 *
 * Key derivation strategy (distributed-safe):
 * - session: IKM = sessionId (unique per session, no external dependency)
 * - tool: IKM = sessionId (same as session, tool name in context)
 * - user: IKM = baseSecret + userId (requires persisted/env secret)
 * - global: IKM = baseSecret (requires persisted/env secret)
 * - custom: IKM = custom key
 */
export async function deriveEncryptionKey(source: EncryptionKeySource): Promise<Uint8Array> {
  const salt = textEncoder.encode('remember-plugin-v1');

  let ikm: string;
  let context: string;

  switch (source.type) {
    case 'session':
      // Session-scoped: use sessionId as IKM (no external dependency)
      ikm = source.sessionId;
      context = `remember:session:${source.sessionId}`;
      break;

    case 'tool':
      // Tool-scoped: same as session (tool name only affects context)
      ikm = source.sessionId;
      context = `remember:tool:${source.toolName}:${source.sessionId}`;
      break;

    case 'user':
      // User-scoped: use baseSecret + userId as IKM
      ikm = (await getBaseSecret()) + source.userId;
      context = `remember:user:${source.userId}`;
      break;

    case 'global':
      // Global-scoped: use baseSecret as IKM
      ikm = await getBaseSecret();
      context = 'remember:global';
      break;

    case 'custom':
      // Custom: use provided key as IKM
      ikm = source.key;
      context = `remember:custom:${source.key}`;
      break;
  }

  const ikmBytes = textEncoder.encode(ikm);
  const info = textEncoder.encode(context);

  return hkdfSha256(ikmBytes, salt, info, 32);
}

/**
 * Get the encryption key source based on scope and context.
 */
export function getKeySourceForScope(
  scope: RememberScope,
  context: {
    sessionId: string;
    userId?: string;
    toolName?: string;
  },
): EncryptionKeySource {
  switch (scope) {
    case 'session':
      return { type: 'session', sessionId: context.sessionId };
    case 'user':
      return { type: 'user', userId: context.userId ?? 'anonymous' };
    case 'tool':
      return {
        type: 'tool',
        toolName: context.toolName ?? 'unknown',
        sessionId: context.sessionId,
      };
    case 'global':
      return { type: 'global' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption / Decryption
// ─────────────────────────────────────────────────────────────────────────────

/** Text decoder for Uint8Array to string conversion */
const textDecoder = new TextDecoder();

/**
 * Encrypt a value using AES-256-GCM.
 * Uses @frontmcp/utils crypto for cross-platform support.
 *
 * @param data - Value to encrypt (will be JSON serialized)
 * @param keySource - Key derivation source
 * @returns Encrypted blob
 */
export async function encryptValue(data: unknown, keySource: EncryptionKeySource): Promise<EncryptedBlob> {
  const key = await deriveEncryptionKey(keySource);
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
 * Decrypt an encrypted blob.
 * Uses @frontmcp/utils crypto for cross-platform support.
 *
 * @param blob - Encrypted blob to decrypt
 * @param keySource - Key derivation source (must match encryption)
 * @returns Decrypted and parsed value, or null if decryption fails
 */
export async function decryptValue<T = unknown>(
  blob: EncryptedBlob,
  keySource: EncryptionKeySource,
): Promise<T | null> {
  try {
    const key = await deriveEncryptionKey(keySource);

    const iv = base64urlDecode(blob.iv);
    const tag = base64urlDecode(blob.tag);
    const ciphertext = base64urlDecode(blob.data);

    const decrypted = decryptAesGcm(key, ciphertext, iv, tag);

    return JSON.parse(textDecoder.decode(decrypted)) as T;
  } catch {
    return null;
  }
}

/**
 * Serialize encrypted blob to a string for storage.
 */
export function serializeBlob(blob: EncryptedBlob): string {
  return JSON.stringify(blob);
}

/**
 * Deserialize a string back to encrypted blob.
 */
export function deserializeBlob(str: string): EncryptedBlob | null {
  try {
    const parsed = JSON.parse(str);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.alg === 'A256GCM' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.tag === 'string' &&
      typeof parsed.data === 'string'
    ) {
      return parsed as EncryptedBlob;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convenience function to encrypt and serialize in one step.
 */
export async function encryptAndSerialize(data: unknown, keySource: EncryptionKeySource): Promise<string> {
  const blob = await encryptValue(data, keySource);
  return serializeBlob(blob);
}

/**
 * Convenience function to deserialize and decrypt in one step.
 */
export async function deserializeAndDecrypt<T = unknown>(
  str: string,
  keySource: EncryptionKeySource,
): Promise<T | null> {
  const blob = deserializeBlob(str);
  if (!blob) return null;
  return decryptValue<T>(blob, keySource);
}
