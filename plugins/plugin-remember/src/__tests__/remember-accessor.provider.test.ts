import { RememberAccessor, createRememberAccessor } from '../providers/remember-accessor.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import type { FrontMcpContext } from '@frontmcp/sdk';
import type { RememberPluginOptions } from '../remember.types';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

class MockStore implements RememberStoreInterface {
  private data = new Map<string, string>();

  async setValue(key: string, value: unknown): Promise<void> {
    this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  async getValue<T = unknown>(key: string): Promise<T | undefined> {
    const val = this.data.get(key);
    if (val === undefined) return undefined;
    return val as unknown as T;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.data.keys());
    if (!pattern) return allKeys;

    // Simple pattern matching (replace * with .*)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return allKeys.filter((k) => regex.test(k));
  }

  async close(): Promise<void> {
    this.data.clear();
  }

  // Helper for tests
  clear(): void {
    this.data.clear();
  }
}

function createMockContext(overrides: Partial<FrontMcpContext> = {}): FrontMcpContext {
  return {
    sessionId: 'test-session-123',
    authInfo: {
      clientId: 'test-user',
      extra: {
        userId: 'user-456',
        sub: 'sub-789',
      },
    },
    flow: {
      name: 'test-tool',
    },
    ...overrides,
  } as unknown as FrontMcpContext;
}

function createConfig(overrides: Partial<RememberPluginOptions> = {}): RememberPluginOptions {
  return {
    type: 'memory',
    keyPrefix: 'remember:',
    encryption: { enabled: false }, // Disable encryption for easier testing
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RememberAccessor', () => {
  let store: MockStore;
  let ctx: FrontMcpContext;
  let config: RememberPluginOptions;
  let accessor: RememberAccessor;

  beforeEach(() => {
    store = new MockStore();
    ctx = createMockContext();
    config = createConfig();
    accessor = new RememberAccessor(store, ctx, config);
  });

  afterEach(() => {
    store.clear();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // set / get
  // ─────────────────────────────────────────────────────────────────────────

  describe('set / get', () => {
    it('stores and retrieves a simple value', async () => {
      await accessor.set('theme', 'dark');
      const result = await accessor.get<string>('theme');

      expect(result).toBe('dark');
    });

    it('stores and retrieves an object', async () => {
      const prefs = { color: 'blue', size: 42 };
      await accessor.set('preferences', prefs);
      const result = await accessor.get<typeof prefs>('preferences');

      expect(result).toEqual(prefs);
    });

    it('returns undefined for non-existent key', async () => {
      const result = await accessor.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns default value for non-existent key', async () => {
      const result = await accessor.get('nonexistent', { defaultValue: 'default' });
      expect(result).toBe('default');
    });

    it('stores with session scope by default', async () => {
      await accessor.set('key', 'value');

      // Check that the key includes session ID
      const keys = await store.keys('remember:session:test-session-123:*');
      expect(keys.length).toBe(1);
    });

    it('stores with user scope', async () => {
      await accessor.set('key', 'value', { scope: 'user' });

      const keys = await store.keys('remember:user:user-456:*');
      expect(keys.length).toBe(1);
    });

    it('stores with tool scope', async () => {
      await accessor.set('key', 'value', { scope: 'tool' });

      const keys = await store.keys('remember:tool:test-tool:test-session-123:*');
      expect(keys.length).toBe(1);
    });

    it('stores with global scope', async () => {
      await accessor.set('key', 'value', { scope: 'global' });

      const keys = await store.keys('remember:global:*');
      expect(keys.length).toBe(1);
    });

    it('retrieves from correct scope', async () => {
      await accessor.set('key', 'session-value', { scope: 'session' });
      await accessor.set('key', 'user-value', { scope: 'user' });

      expect(await accessor.get('key', { scope: 'session' })).toBe('session-value');
      expect(await accessor.get('key', { scope: 'user' })).toBe('user-value');
    });

    it('stores with brand metadata', async () => {
      await accessor.set('pref', 'value', { brand: 'preference' });
      const entry = await accessor.getEntry<string>('pref');

      expect(entry?.brand).toBe('preference');
    });

    it('stores with custom metadata', async () => {
      await accessor.set('data', 'value', {
        metadata: { source: 'test', version: 1 },
      });
      const entry = await accessor.getEntry<string>('data');

      expect(entry?.metadata).toEqual({ source: 'test', version: 1 });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getEntry
  // ─────────────────────────────────────────────────────────────────────────

  describe('getEntry', () => {
    it('returns full entry with metadata', async () => {
      await accessor.set('key', 'value', { brand: 'test' });
      const entry = await accessor.getEntry<string>('key');

      expect(entry).toBeDefined();
      expect(entry?.value).toBe('value');
      expect(entry?.brand).toBe('test');
      expect(entry?.createdAt).toBeGreaterThan(0);
      expect(entry?.updatedAt).toBeGreaterThan(0);
    });

    it('returns undefined for non-existent key', async () => {
      const entry = await accessor.getEntry('nonexistent');
      expect(entry).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // forget
  // ─────────────────────────────────────────────────────────────────────────

  describe('forget', () => {
    it('removes a stored value', async () => {
      await accessor.set('key', 'value');
      await accessor.forget('key');

      const result = await accessor.get('key');
      expect(result).toBeUndefined();
    });

    it('forgets from correct scope', async () => {
      await accessor.set('key', 'session-value', { scope: 'session' });
      await accessor.set('key', 'user-value', { scope: 'user' });

      await accessor.forget('key', { scope: 'session' });

      expect(await accessor.get('key', { scope: 'session' })).toBeUndefined();
      expect(await accessor.get('key', { scope: 'user' })).toBe('user-value');
    });

    it('does not throw when forgetting non-existent key', async () => {
      await expect(accessor.forget('nonexistent')).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // knows
  // ─────────────────────────────────────────────────────────────────────────

  describe('knows', () => {
    it('returns true for existing key', async () => {
      await accessor.set('key', 'value');
      const knows = await accessor.knows('key');

      expect(knows).toBe(true);
    });

    it('returns false for non-existent key', async () => {
      const knows = await accessor.knows('nonexistent');
      expect(knows).toBe(false);
    });

    it('checks correct scope', async () => {
      await accessor.set('key', 'value', { scope: 'user' });

      expect(await accessor.knows('key', { scope: 'user' })).toBe(true);
      expect(await accessor.knows('key', { scope: 'session' })).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // list
  // ─────────────────────────────────────────────────────────────────────────

  describe('list', () => {
    beforeEach(async () => {
      await accessor.set('key1', 'value1');
      await accessor.set('key2', 'value2');
      await accessor.set('prefix:key3', 'value3');
    });

    it('lists all keys for a scope', async () => {
      const keys = await accessor.list();

      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('prefix:key3');
    });

    it('filters keys with pattern', async () => {
      const keys = await accessor.list({ pattern: 'key*' });

      expect(keys).toHaveLength(2);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('lists only keys from specified scope', async () => {
      await accessor.set('user-key', 'value', { scope: 'user' });

      const sessionKeys = await accessor.list({ scope: 'session' });
      const userKeys = await accessor.list({ scope: 'user' });

      expect(sessionKeys).not.toContain('user-key');
      expect(userKeys).toContain('user-key');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // update
  // ─────────────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates existing value and preserves metadata', async () => {
      await accessor.set('key', 'original', { brand: 'test', metadata: { v: 1 } });

      const beforeUpdate = Date.now();
      await new Promise((r) => setTimeout(r, 10));

      const success = await accessor.update('key', 'updated');

      expect(success).toBe(true);

      const entry = await accessor.getEntry<string>('key');
      expect(entry?.value).toBe('updated');
      expect(entry?.brand).toBe('test');
      expect(entry?.metadata).toEqual({ v: 1 });
      expect(entry?.updatedAt).toBeGreaterThan(beforeUpdate);
    });

    it('returns false for non-existent key', async () => {
      const success = await accessor.update('nonexistent', 'value');
      expect(success).toBe(false);
    });

    it('updates in correct scope', async () => {
      await accessor.set('key', 'session', { scope: 'session' });
      await accessor.set('key', 'user', { scope: 'user' });

      await accessor.update('key', 'updated-user', { scope: 'user' });

      expect(await accessor.get('key', { scope: 'session' })).toBe('session');
      expect(await accessor.get('key', { scope: 'user' })).toBe('updated-user');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Context Properties
  // ─────────────────────────────────────────────────────────────────────────

  describe('context properties', () => {
    it('exposes sessionId', () => {
      expect(accessor.sessionId).toBe('test-session-123');
    });

    it('exposes userId from authInfo.extra.userId', () => {
      expect(accessor.userId).toBe('user-456');
    });

    it('falls back to authInfo.extra.sub for userId', () => {
      const ctx2 = createMockContext({
        authInfo: {
          clientId: 'client-id',
          extra: { sub: 'sub-123' },
        },
      } as Partial<FrontMcpContext>);
      const accessor2 = new RememberAccessor(store, ctx2, config);

      expect(accessor2.userId).toBe('sub-123');
    });

    it('falls back to clientId for userId', () => {
      const ctx2 = createMockContext({
        authInfo: {
          clientId: 'client-id',
          extra: {},
        },
      } as Partial<FrontMcpContext>);
      const accessor2 = new RememberAccessor(store, ctx2, config);

      expect(accessor2.userId).toBe('client-id');
    });

    it('returns undefined when no userId available', () => {
      const ctx2 = createMockContext({
        authInfo: undefined,
      } as Partial<FrontMcpContext>);
      const accessor2 = new RememberAccessor(store, ctx2, config);

      expect(accessor2.userId).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Encryption
  // ─────────────────────────────────────────────────────────────────────────

  describe('encryption', () => {
    it('encrypts data when enabled', async () => {
      const encryptedConfig = createConfig({ encryption: { enabled: true } });
      const encryptedAccessor = new RememberAccessor(store, ctx, encryptedConfig);

      await encryptedAccessor.set('secret', 'my-password');

      // Get raw value from store
      const raw = await store.getValue<string>('remember:session:test-session-123:secret');
      expect(raw).toBeDefined();

      // Should not be readable as plain JSON
      expect(() => {
        const parsed = JSON.parse(raw!);
        expect(parsed.value).not.toBe('my-password');
      }).not.toThrow();

      // Should be decrypted correctly when retrieved
      const result = await encryptedAccessor.get<string>('secret');
      expect(result).toBe('my-password');
    });

    it('stores plain JSON when encryption disabled', async () => {
      await accessor.set('plain', 'value');

      const raw = await store.getValue<string>('remember:session:test-session-123:plain');
      const parsed = JSON.parse(raw!);

      expect(parsed.value).toBe('value');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Key Prefix
  // ─────────────────────────────────────────────────────────────────────────

  describe('key prefix', () => {
    it('uses custom key prefix', async () => {
      const customConfig = createConfig({ keyPrefix: 'custom:' });
      const customAccessor = new RememberAccessor(store, ctx, customConfig);

      await customAccessor.set('key', 'value');

      const keys = await store.keys('custom:*');
      expect(keys.length).toBe(1);
      expect(keys[0]).toMatch(/^custom:session:/);
    });

    it('uses default prefix when not specified', async () => {
      const noPrefix = createConfig();
      delete (noPrefix as Record<string, unknown>).keyPrefix;
      const accessor2 = new RememberAccessor(store, ctx, noPrefix);

      await accessor2.set('key', 'value');

      const keys = await store.keys('remember:*');
      expect(keys.length).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Factory Function
  // ─────────────────────────────────────────────────────────────────────────

  describe('createRememberAccessor', () => {
    it('creates a RememberAccessor instance', () => {
      const result = createRememberAccessor(store, ctx, config);
      expect(result).toBeInstanceOf(RememberAccessor);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge Cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles anonymous user scope', async () => {
      const anonCtx = createMockContext({ authInfo: undefined });
      const anonAccessor = new RememberAccessor(store, anonCtx, config);

      await anonAccessor.set('key', 'value', { scope: 'user' });

      const keys = await store.keys('remember:user:anonymous:*');
      expect(keys.length).toBe(1);
    });

    it('handles unknown tool scope', async () => {
      const noFlowCtx = createMockContext({ flow: undefined });
      const noFlowAccessor = new RememberAccessor(store, noFlowCtx, config);

      await noFlowAccessor.set('key', 'value', { scope: 'tool' });

      const keys = await store.keys('remember:tool:unknown:*');
      expect(keys.length).toBe(1);
    });

    it('handles special characters in keys', async () => {
      await accessor.set('key:with:colons', 'value1');
      await accessor.set('key/with/slashes', 'value2');
      await accessor.set('key with spaces', 'value3');

      expect(await accessor.get('key:with:colons')).toBe('value1');
      expect(await accessor.get('key/with/slashes')).toBe('value2');
      expect(await accessor.get('key with spaces')).toBe('value3');
    });

    it('handles null and undefined values', async () => {
      await accessor.set('null', null);
      await accessor.set('undefined', undefined);

      expect(await accessor.get('null')).toBeNull();
      expect(await accessor.get('undefined')).toBeUndefined();
    });
  });
});
