/**
 * Storage Factory Tests
 */
import { createStorage, createMemoryStorage, getDetectedStorageType } from '../factory';

describe('Storage Factory', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear storage-related env vars
    delete process.env['REDIS_URL'];
    delete process.env['REDIS_HOST'];
    delete process.env['UPSTASH_REDIS_REST_URL'];
    delete process.env['UPSTASH_REDIS_REST_TOKEN'];
    delete process.env['KV_REST_API_URL'];
    delete process.env['KV_REST_API_TOKEN'];
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    // Restore original env vars
    process.env = { ...originalEnv };
  });

  describe('createStorage', () => {
    describe('explicit memory type', () => {
      it('should create memory storage', async () => {
        const storage = await createStorage({ type: 'memory' });
        expect(await storage.ping()).toBe(true);

        await storage.set('key', 'value');
        expect(await storage.get('key')).toBe('value');

        await storage.disconnect();
      });

      it('should apply memory options', async () => {
        const storage = await createStorage({
          type: 'memory',
          memory: { maxEntries: 5 },
        });

        // Fill beyond capacity
        for (let i = 0; i < 10; i++) {
          await storage.set(`key${i}`, `value${i}`);
        }

        // Should have evicted oldest entries
        const count = await storage.count();
        expect(count).toBe(5);

        await storage.disconnect();
      });
    });

    describe('with prefix', () => {
      it('should apply root prefix', async () => {
        const storage = await createStorage({
          type: 'memory',
          prefix: 'myapp',
        });

        await storage.set('key', 'value');

        // Access underlying adapter to verify prefix
        const allKeys = await storage.root.keys('*');
        expect(allKeys).toContain('myapp:key');

        await storage.disconnect();
      });
    });

    describe('auto detection', () => {
      it('should detect memory when no env vars set', async () => {
        const storage = await createStorage({ type: 'auto' });
        expect(await storage.ping()).toBe(true);
        await storage.disconnect();
      });

      it('should default to auto when type not specified', async () => {
        const storage = await createStorage();
        expect(await storage.ping()).toBe(true);
        await storage.disconnect();
      });
    });

    describe('fallback behavior', () => {
      it('should fallback to memory on connection failure in non-production', async () => {
        // This test relies on memory being used when no distributed backend is available
        const storage = await createStorage({
          type: 'auto',
          fallback: 'memory',
        });

        expect(await storage.ping()).toBe(true);
        await storage.disconnect();
      });
    });
  });

  describe('createMemoryStorage', () => {
    it('should create memory storage synchronously', () => {
      const storage = createMemoryStorage();
      expect(storage.prefix).toBe('');
    });

    it('should apply prefix', () => {
      const storage = createMemoryStorage({ prefix: 'test' });
      expect(storage.prefix).toBe('test:');
    });

    it('should apply memory options', () => {
      const storage = createMemoryStorage({
        maxEntries: 100,
        enableSweeper: false,
      });

      // Should be able to use it (after connect)
      expect(storage).toBeDefined();
    });

    it('should work after connect', async () => {
      const storage = createMemoryStorage();
      await storage.connect();

      await storage.set('key', 'value');
      expect(await storage.get('key')).toBe('value');

      await storage.disconnect();
    });
  });

  describe('getDetectedStorageType', () => {
    it('should return memory when no env vars set', () => {
      expect(getDetectedStorageType()).toBe('memory');
    });

    it('should detect upstash when env vars set', () => {
      process.env['UPSTASH_REDIS_REST_URL'] = 'https://upstash.example.com';
      process.env['UPSTASH_REDIS_REST_TOKEN'] = 'token';

      expect(getDetectedStorageType()).toBe('upstash');
    });

    it('should detect vercel-kv when env vars set', () => {
      process.env['KV_REST_API_URL'] = 'https://kv.example.com';
      process.env['KV_REST_API_TOKEN'] = 'token';

      expect(getDetectedStorageType()).toBe('vercel-kv');
    });

    it('should detect redis when REDIS_URL set', () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';

      expect(getDetectedStorageType()).toBe('redis');
    });

    it('should detect redis when REDIS_HOST set', () => {
      process.env['REDIS_HOST'] = 'localhost';

      expect(getDetectedStorageType()).toBe('redis');
    });

    it('should prioritize upstash over vercel-kv', () => {
      process.env['UPSTASH_REDIS_REST_URL'] = 'https://upstash.example.com';
      process.env['UPSTASH_REDIS_REST_TOKEN'] = 'token';
      process.env['KV_REST_API_URL'] = 'https://kv.example.com';
      process.env['KV_REST_API_TOKEN'] = 'token';

      expect(getDetectedStorageType()).toBe('upstash');
    });

    it('should prioritize vercel-kv over redis', () => {
      process.env['KV_REST_API_URL'] = 'https://kv.example.com';
      process.env['KV_REST_API_TOKEN'] = 'token';
      process.env['REDIS_URL'] = 'redis://localhost:6379';

      expect(getDetectedStorageType()).toBe('vercel-kv');
    });
  });

  describe('integration', () => {
    it('should support full workflow', async () => {
      const storage = await createStorage({ type: 'memory' });

      // Create namespaced storage
      const session = storage.namespace('session', 'abc123');

      // Basic operations
      await session.set('user', JSON.stringify({ name: 'John' }));
      const userData = await session.get('user');
      expect(userData).not.toBeNull();
      expect(JSON.parse(userData as string)).toEqual({ name: 'John' });

      // TTL
      await session.set('temp', 'data', { ttlSeconds: 60 });
      const ttl = await session.ttl('temp');
      expect(ttl).toBeGreaterThan(0);

      // Atomic operations
      await session.incr('counter');
      await session.incr('counter');
      expect(await session.get('counter')).toBe('2');

      // Key enumeration
      const keys = await session.keys('*');
      expect(keys).toContain('user');
      expect(keys).toContain('temp');
      expect(keys).toContain('counter');

      // Cleanup
      await session.delete('user');
      expect(await session.exists('user')).toBe(false);

      await storage.disconnect();
    });

    it('should support nested namespaces', async () => {
      const storage = await createStorage({ type: 'memory' });

      const app = storage.namespace('app', 'myapp');
      const users = app.namespace('users');
      const user1 = users.namespace('user', '1');

      await user1.set('profile', JSON.stringify({ name: 'User 1' }));
      await user1.set('settings', JSON.stringify({ theme: 'dark' }));

      // Check actual keys in storage
      const allKeys = await storage.root.keys('*');
      expect(allKeys).toContain('app:myapp:users:user:1:profile');
      expect(allKeys).toContain('app:myapp:users:user:1:settings');

      // Access through namespace
      expect(await user1.get('profile')).toBe(JSON.stringify({ name: 'User 1' }));

      await storage.disconnect();
    });
  });
});
