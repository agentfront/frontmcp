/**
 * Orchestrated token-record encryption helpers.
 *
 * Shared by {@link InMemoryOrchestratedTokenStore} and
 * {@link StorageOrchestratedTokenStore} so both apply byte-for-byte identical
 * AES-256-GCM encryption: a per-composite-key subkey is derived from the master
 * `encryptionKey` via HKDF-SHA256, and the record JSON is sealed with a random
 * 12-byte IV. The envelope is a base64url JSON `{ iv, tag, data }`.
 */

import { decryptAesGcm, encryptAesGcm, hkdfSha256, randomBytes } from '@frontmcp/utils';

import { REFRESH_TOKEN_TTL_MS } from './authorization.store';

/**
 * Internal token record structure (upstream provider tokens).
 */
export interface ProviderTokenRecord {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * When a record is dropped. Its access token's expiry, unless it holds a refresh token: the access
 * token is then renewed with it, so the record stays until it hasn't been written for as long as
 * FrontMCP's own refresh tokens live.
 */
export function recordDropAt(record: ProviderTokenRecord): number | undefined {
  if (!record.refreshToken) return record.expiresAt;
  return Math.max(record.expiresAt ?? 0, record.updatedAt + REFRESH_TOKEN_TTL_MS);
}

/**
 * Whether the record's access token is still usable. One that can be refreshed counts as expired
 * `refreshSkewMs` before its expiry, so it is renewed before it lapses.
 */
export function hasLiveAccessToken(record: ProviderTokenRecord, refreshSkewMs = 0): boolean {
  if (record.expiresAt === undefined) return true;
  return record.expiresAt - (record.refreshToken ? refreshSkewMs : 0) > Date.now();
}

const HKDF_SALT = new TextEncoder().encode('frontmcp-token-store');

/**
 * Derive a per-record AES key from the master key + composite key via HKDF.
 * Results are cached in `cache` (keyed by composite key) to avoid recomputation.
 */
export function deriveKeyForRecord(
  masterKey: Uint8Array,
  compositeKey: string,
  cache: Map<string, Uint8Array>,
): Uint8Array {
  const cached = cache.get(compositeKey);
  if (cached) {
    return cached;
  }
  const info = new TextEncoder().encode(`orchestrated-token:${compositeKey}`);
  const derived = hkdfSha256(masterKey, HKDF_SALT, info, 32);
  cache.set(compositeKey, derived);
  return derived;
}

/**
 * Encrypt a token record into a base64url JSON envelope string.
 */
export function encryptRecord(key: Uint8Array, record: ProviderTokenRecord): string {
  const plaintext = JSON.stringify(record);
  const iv = randomBytes(12);
  const { ciphertext, tag } = encryptAesGcm(key, new TextEncoder().encode(plaintext), iv);
  return JSON.stringify({
    iv: Buffer.from(iv).toString('base64url'),
    tag: Buffer.from(tag).toString('base64url'),
    data: Buffer.from(ciphertext).toString('base64url'),
  });
}

/**
 * Decrypt a base64url JSON envelope string back into a token record.
 */
export function decryptRecord(key: Uint8Array, encrypted: string): ProviderTokenRecord {
  const { iv, tag, data } = JSON.parse(encrypted) as { iv: string; tag: string; data: string };
  const ivBytes = Buffer.from(iv, 'base64url');
  const tagBytes = Buffer.from(tag, 'base64url');
  const ciphertextBytes = Buffer.from(data, 'base64url');
  const plaintext = decryptAesGcm(key, ciphertextBytes, ivBytes, tagBytes);
  return JSON.parse(new TextDecoder().decode(plaintext)) as ProviderTokenRecord;
}
