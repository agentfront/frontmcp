/**
 * orchestrated-token.crypto Tests
 *
 * Covers the shared AES-256-GCM + HKDF helpers used by both the in-memory and
 * storage-backed orchestrated token stores: per-record key derivation (with
 * caching), the encrypt → decrypt round-trip, and the tamper / wrong-key
 * failure paths.
 */

import { randomBytes } from '@frontmcp/utils';

import {
  decryptRecord,
  deriveKeyForRecord,
  encryptRecord,
  type ProviderTokenRecord,
} from '../orchestrated-token.crypto';

function masterKey(): Uint8Array {
  return randomBytes(32);
}

function sampleRecord(overrides: Partial<ProviderTokenRecord> = {}): ProviderTokenRecord {
  const now = Date.now();
  return {
    accessToken: 'gho_access',
    refreshToken: 'ghr_refresh',
    expiresAt: now + 3_600_000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('orchestrated-token.crypto', () => {
  describe('deriveKeyForRecord', () => {
    it('derives a 32-byte key', () => {
      const key = deriveKeyForRecord(masterKey(), 'auth-1:github', new Map());
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('is deterministic for the same master key + composite key', () => {
      const master = masterKey();
      const a = deriveKeyForRecord(master, 'auth-1:github', new Map());
      const b = deriveKeyForRecord(master, 'auth-1:github', new Map());
      expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    });

    it('derives different keys for different composite keys', () => {
      const master = masterKey();
      const gh = deriveKeyForRecord(master, 'auth-1:github', new Map());
      const gg = deriveKeyForRecord(master, 'auth-1:google', new Map());
      expect(Buffer.from(gh).toString('hex')).not.toBe(Buffer.from(gg).toString('hex'));
    });

    it('caches derived keys (second call returns the cached instance)', () => {
      const master = masterKey();
      const cache = new Map<string, Uint8Array>();
      const first = deriveKeyForRecord(master, 'auth-1:github', cache);
      expect(cache.size).toBe(1);
      const second = deriveKeyForRecord(master, 'auth-1:github', cache);
      // Same reference proves the cache short-circuit, not a recompute.
      expect(second).toBe(first);
    });
  });

  describe('encryptRecord / decryptRecord', () => {
    it('round-trips a record', () => {
      const key = deriveKeyForRecord(masterKey(), 'auth-1:github', new Map());
      const record = sampleRecord();
      const envelope = encryptRecord(key, record);
      expect(decryptRecord(key, envelope)).toEqual(record);
    });

    it('produces a base64url JSON envelope with iv/tag/data', () => {
      const key = deriveKeyForRecord(masterKey(), 'auth-1:github', new Map());
      const envelope = encryptRecord(key, sampleRecord());
      const parsed = JSON.parse(envelope) as { iv: string; tag: string; data: string };
      expect(typeof parsed.iv).toBe('string');
      expect(typeof parsed.tag).toBe('string');
      expect(typeof parsed.data).toBe('string');
      // Ciphertext must not leak the plaintext token.
      expect(envelope).not.toContain('gho_access');
    });

    it('uses a fresh IV per call (ciphertext differs for identical input)', () => {
      const key = deriveKeyForRecord(masterKey(), 'auth-1:github', new Map());
      const record = sampleRecord();
      const a = JSON.parse(encryptRecord(key, record)) as { iv: string; data: string };
      const b = JSON.parse(encryptRecord(key, record)) as { iv: string; data: string };
      expect(a.iv).not.toBe(b.iv);
      expect(a.data).not.toBe(b.data);
    });

    it('round-trips a record without a refresh token / expiry', () => {
      const key = deriveKeyForRecord(masterKey(), 'auth-1:slack', new Map());
      const record = sampleRecord({ refreshToken: undefined, expiresAt: undefined });
      const out = decryptRecord(key, encryptRecord(key, record));
      expect(out.accessToken).toBe('gho_access');
      expect(out.refreshToken).toBeUndefined();
      expect(out.expiresAt).toBeUndefined();
    });

    it('fails to decrypt with the wrong key', () => {
      const composite = 'auth-1:github';
      const rightKey = deriveKeyForRecord(masterKey(), composite, new Map());
      const wrongKey = deriveKeyForRecord(masterKey(), composite, new Map());
      const envelope = encryptRecord(rightKey, sampleRecord());
      expect(() => decryptRecord(wrongKey, envelope)).toThrow();
    });

    it('fails to decrypt a tampered ciphertext (GCM auth tag mismatch)', () => {
      const key = deriveKeyForRecord(masterKey(), 'auth-1:github', new Map());
      const parsed = JSON.parse(encryptRecord(key, sampleRecord())) as {
        iv: string;
        tag: string;
        data: string;
      };
      // Flip a byte in the ciphertext.
      const dataBytes = Buffer.from(parsed.data, 'base64url');
      dataBytes[0] = dataBytes[0] ^ 0xff;
      const tampered = JSON.stringify({ ...parsed, data: dataBytes.toString('base64url') });
      expect(() => decryptRecord(key, tampered)).toThrow();
    });

    it('fails to decrypt a tampered auth tag', () => {
      const key = deriveKeyForRecord(masterKey(), 'auth-1:github', new Map());
      const parsed = JSON.parse(encryptRecord(key, sampleRecord())) as {
        iv: string;
        tag: string;
        data: string;
      };
      const tagBytes = Buffer.from(parsed.tag, 'base64url');
      tagBytes[0] = tagBytes[0] ^ 0xff;
      const tampered = JSON.stringify({ ...parsed, tag: tagBytes.toString('base64url') });
      expect(() => decryptRecord(key, tampered)).toThrow();
    });

    it('throws on a non-JSON envelope', () => {
      const key = deriveKeyForRecord(masterKey(), 'auth-1:github', new Map());
      expect(() => decryptRecord(key, 'not-json')).toThrow();
    });
  });
});
