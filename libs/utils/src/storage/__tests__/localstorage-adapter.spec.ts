/**
 * LocalStorage Adapter Tests — encryption at rest
 */
import { LocalStorageAdapter } from '../adapters/localstorage';
import { randomBytes, encryptAesGcm, base64urlEncode } from '../../crypto';

// ---------------------------------------------------------------------------
// localStorage mock (Map-backed)
// ---------------------------------------------------------------------------
const store = new Map<string, string>();

const localStorageMock: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function makeKey(len = 32): Uint8Array {
  return randomBytes(len);
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
describe('LocalStorageAdapter — encryption', () => {
  beforeEach(() => store.clear());

  describe('constructor validation', () => {
    it('should accept a 32-byte key', () => {
      expect(() => new LocalStorageAdapter({ encryptionKey: makeKey(32) })).not.toThrow();
    });

    it('should reject a non-32-byte key', () => {
      expect(() => new LocalStorageAdapter({ encryptionKey: makeKey(16) })).toThrow(
        'encryptionKey must be exactly 32 bytes',
      );
      expect(() => new LocalStorageAdapter({ encryptionKey: makeKey(64) })).toThrow(
        'encryptionKey must be exactly 32 bytes',
      );
    });

    it('should allow no key (plaintext mode)', () => {
      expect(() => new LocalStorageAdapter()).not.toThrow();
    });
  });

  describe('encrypted round-trip', () => {
    it('should encrypt then decrypt (set/get)', async () => {
      const key = makeKey();
      const adapter = new LocalStorageAdapter({ encryptionKey: key });
      await adapter.connect();

      await adapter.set('secret', 'my-secret-value');
      const value = await adapter.get('secret');

      expect(value).toBe('my-secret-value');
    });

    it('should store _enc blob, not plaintext, in raw localStorage', async () => {
      const key = makeKey();
      const adapter = new LocalStorageAdapter({ encryptionKey: key });
      await adapter.connect();

      await adapter.set('secret', 'plaintext-should-not-appear');

      const raw = store.get('frontmcp:secret');
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);

      // The value field should be empty (not the plaintext)
      expect(parsed.v).toBe('');
      // Encrypted blob must be present
      expect(parsed._enc).toBeDefined();
      expect(parsed._enc.alg).toBe('A256GCM');
      expect(parsed._enc.iv).toBeDefined();
      expect(parsed._enc.tag).toBeDefined();
      expect(parsed._enc.data).toBeDefined();
      // Raw JSON must NOT contain the plaintext value
      expect(raw).not.toContain('plaintext-should-not-appear');
    });
  });

  describe('TTL with encryption', () => {
    it('should respect TTL on encrypted entries', async () => {
      const key = makeKey();
      const adapter = new LocalStorageAdapter({ encryptionKey: key });
      await adapter.connect();

      // Use a very short TTL; fake time
      const realNow = Date.now;
      let fakeTime = realNow.call(Date);
      Date.now = () => fakeTime;

      try {
        await adapter.set('temp', 'encrypted-ttl', { ttlSeconds: 10 });
        expect(await adapter.get('temp')).toBe('encrypted-ttl');

        // Advance time past TTL
        fakeTime += 11_000;
        expect(await adapter.get('temp')).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });
  });

  describe('backward compatibility', () => {
    it('should read legacy plaintext entries when adapter has encryption key', async () => {
      // Write a legacy (no encryption) entry directly
      store.set('frontmcp:legacy', JSON.stringify({ v: 'old-value' }));

      const key = makeKey();
      const adapter = new LocalStorageAdapter({ encryptionKey: key });
      await adapter.connect();

      // Should return the plaintext value (no _enc field → passthrough)
      expect(await adapter.get('legacy')).toBe('old-value');
    });

    it('should return null when plaintext adapter reads an encrypted entry', async () => {
      // Write an encrypted entry with one adapter
      const key = makeKey();
      const encAdapter = new LocalStorageAdapter({ encryptionKey: key });
      await encAdapter.connect();
      await encAdapter.set('secret', 'hidden');

      // Read with a plaintext adapter (no key)
      const plainAdapter = new LocalStorageAdapter();
      await plainAdapter.connect();
      expect(await plainAdapter.get('secret')).toBeNull();
    });
  });

  describe('wrong key', () => {
    it('should return null when decryption fails with wrong key', async () => {
      const key1 = makeKey();
      const key2 = makeKey();
      const adapter1 = new LocalStorageAdapter({ encryptionKey: key1 });
      const adapter2 = new LocalStorageAdapter({ encryptionKey: key2 });

      await adapter1.connect();
      await adapter2.connect();

      await adapter1.set('secret', 'my-value');

      // Different key should fail decryption → null
      expect(await adapter2.get('secret')).toBeNull();
    });
  });

  describe('plaintext mode (no key)', () => {
    it('should store and retrieve values as plaintext', async () => {
      const adapter = new LocalStorageAdapter();
      await adapter.connect();

      await adapter.set('plain', 'hello');
      expect(await adapter.get('plain')).toBe('hello');

      const raw = store.get('frontmcp:plain');
      const parsed = JSON.parse(raw!);
      expect(parsed.v).toBe('hello');
      expect(parsed._enc).toBeUndefined();
    });
  });
});
