import 'reflect-metadata';
import type { ProviderFactoryType } from '@frontmcp/sdk';
import CachePlugin from '../cache.plugin';
import { CacheStoreToken } from '../cache.symbol';
import CacheRedisProvider from '../providers/cache-redis.provider';
import CacheMemoryProvider from '../providers/cache-memory.provider';
import CacheVercelKvProvider from '../providers/cache-vercel-kv.provider';

// Helper type for value providers returned by dynamicProviders
type ValueProvider = { name: string; provide: symbol; useValue: unknown };
// Helper type for factory providers returned by dynamicProviders
type FactoryProvider = {
  name: string;
  provide: symbol;
  inject: () => unknown[];
  useFactory: (...args: unknown[]) => unknown;
};

// Mock ioredis to prevent actual Redis connections
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    quit: jest.fn(),
  }));
});

// Mock @vercel/kv
jest.mock('@vercel/kv', () => ({
  kv: {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  },
  createClient: jest.fn().mockReturnValue({
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  }),
}));

describe('CachePlugin', () => {
  describe('dynamicProviders', () => {
    describe('type: memory', () => {
      it('should create memory provider with default TTL', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'memory' });
        const provider = providers[0] as ValueProvider;

        expect(providers).toHaveLength(1);
        expect(provider.name).toBe('cache:memory');
        expect(provider.provide).toBe(CacheStoreToken);
        expect(provider.useValue).toBeInstanceOf(CacheMemoryProvider);
      });

      it('should create memory provider with custom TTL', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'memory',
          defaultTTL: 7200,
        });
        const provider = providers[0] as ValueProvider;

        expect(providers).toHaveLength(1);
        expect(provider.useValue).toBeInstanceOf(CacheMemoryProvider);
      });
    });

    describe('type: redis', () => {
      it('should create redis provider with config', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'redis',
          config: {
            host: 'localhost',
            port: 6379,
            password: 'secret',
            db: 1,
          },
        });
        const provider = providers[0] as ValueProvider;

        expect(providers).toHaveLength(1);
        expect(provider.name).toBe('cache:redis');
        expect(provider.provide).toBe(CacheStoreToken);
        expect(provider.useValue).toBeInstanceOf(CacheRedisProvider);
      });

      it('should create redis provider with defaultTTL', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'redis',
          config: { host: 'localhost', port: 6379 },
          defaultTTL: 3600,
        });
        const provider = providers[0] as ValueProvider;

        expect(providers).toHaveLength(1);
        expect(provider.useValue).toBeInstanceOf(CacheRedisProvider);
      });
    });

    describe('type: redis-client', () => {
      it('should create redis provider with existing client', () => {
        const mockClient = {
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          exists: jest.fn(),
          quit: jest.fn(),
          on: jest.fn(),
        } as any;

        const providers = CachePlugin.dynamicProviders({
          type: 'redis-client',
          client: mockClient,
        });
        const provider = providers[0] as ValueProvider;

        expect(providers).toHaveLength(1);
        expect(provider.name).toBe('cache:redis');
        expect(provider.useValue).toBeInstanceOf(CacheRedisProvider);
      });
    });

    describe('type: global-store', () => {
      it('should create provider with inject and useFactory', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });
        const provider = providers[0] as FactoryProvider;

        expect(providers).toHaveLength(1);
        expect(provider.name).toBe('cache:global-store');
        expect(provider.provide).toBe(CacheStoreToken);
        expect(provider.inject).toBeDefined();
        expect(provider.useFactory).toBeDefined();
        expect(typeof provider.inject).toBe('function');
        expect(typeof provider.useFactory).toBe('function');
      });

      it('should inject FrontMcpConfig token', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });
        const provider = providers[0] as FactoryProvider;
        const tokens = provider.inject();

        expect(tokens).toHaveLength(1);
        expect(typeof tokens[0]).toBe('symbol');
      });

      it('should create Vercel KV provider when global config is vercel-kv', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'global-store',
          defaultTTL: 1800,
        });
        const provider = providers[0] as FactoryProvider;

        const mockConfig = {
          redis: {
            provider: 'vercel-kv',
            url: 'https://kv.vercel.com',
            token: 'secret-token',
            keyPrefix: 'app:',
          },
        };

        const result = provider.useFactory(mockConfig);
        expect(result).toBeInstanceOf(CacheVercelKvProvider);
      });

      it('should create Redis provider when global config is redis', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'global-store',
          defaultTTL: 3600,
        });
        const provider = providers[0] as FactoryProvider;

        const mockConfig = {
          redis: {
            provider: 'redis',
            host: 'redis.example.com',
            port: 6380,
            password: 'secret',
            db: 2,
          },
        };

        const result = provider.useFactory(mockConfig);
        expect(result).toBeInstanceOf(CacheRedisProvider);
      });

      it('should create Redis provider for legacy config without provider field', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });
        const provider = providers[0] as FactoryProvider;

        const mockConfig = {
          redis: {
            host: 'legacy-host',
            port: 6379,
          },
        };

        const result = provider.useFactory(mockConfig);
        expect(result).toBeInstanceOf(CacheRedisProvider);
      });

      it('should throw GlobalConfigNotFoundError when redis is not configured', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });
        const provider = providers[0] as FactoryProvider;

        expect(() => provider.useFactory({ redis: undefined })).toThrow(
          'Plugin "CachePlugin" requires global "redis" configuration',
        );
      });

      it('should throw GlobalConfigNotFoundError when config has no redis', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });
        const provider = providers[0] as FactoryProvider;

        expect(() => provider.useFactory({})).toThrow('Plugin "CachePlugin" requires global "redis" configuration');
      });

      it('should pass defaultTTL to Vercel KV provider', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'global-store',
          defaultTTL: 7200,
        });
        const provider = providers[0] as FactoryProvider;

        const mockConfig = {
          redis: {
            provider: 'vercel-kv',
          },
        };

        const result = provider.useFactory(mockConfig) as CacheVercelKvProvider;
        expect(result).toBeInstanceOf(CacheVercelKvProvider);
      });
    });
  });

  describe('defaultOptions', () => {
    it('should have memory as default type', () => {
      expect(CachePlugin.defaultOptions).toEqual({ type: 'memory' });
    });
  });

  describe('constructor', () => {
    it('should set default TTL to 1 day', () => {
      const plugin = new CachePlugin();
      expect(plugin.options.defaultTTL).toBe(60 * 60 * 24);
    });

    it('should merge provided options with defaults', () => {
      const plugin = new CachePlugin({ type: 'memory', defaultTTL: 3600 });
      expect(plugin.options.type).toBe('memory');
      expect(plugin.options.defaultTTL).toBe(3600);
    });

    it('should accept toolPatterns array option', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        toolPatterns: ['mintlify:*', 'local:ping'],
      });
      expect(plugin.options.toolPatterns).toEqual(['mintlify:*', 'local:ping']);
    });

    it('should accept bypassHeader option', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        bypassHeader: 'x-no-cache',
      });
      expect(plugin.options.bypassHeader).toBe('x-no-cache');
    });
  });

  describe('isCacheable', () => {
    it('should return false when no toolPatterns configured', () => {
      const plugin = new CachePlugin({ type: 'memory' });
      expect(plugin.isCacheable('any-tool')).toBe(false);
    });

    it('should match exact tool names', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        toolPatterns: ['local:ping', 'api:get-users'],
      });

      expect(plugin.isCacheable('local:ping')).toBe(true);
      expect(plugin.isCacheable('api:get-users')).toBe(true);
      expect(plugin.isCacheable('local:echo')).toBe(false);
      expect(plugin.isCacheable('other:tool')).toBe(false);
    });

    it('should match namespace wildcard patterns', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        toolPatterns: ['mintlify:*'],
      });

      expect(plugin.isCacheable('mintlify:SearchMintlify')).toBe(true);
      expect(plugin.isCacheable('mintlify:GetDocs')).toBe(true);
      expect(plugin.isCacheable('mintlify:nested:tool')).toBe(true);
      expect(plugin.isCacheable('other:tool')).toBe(false);
    });

    it('should match prefix wildcard patterns', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        toolPatterns: ['api:get-*'],
      });

      expect(plugin.isCacheable('api:get-users')).toBe(true);
      expect(plugin.isCacheable('api:get-orders')).toBe(true);
      expect(plugin.isCacheable('api:get-')).toBe(true);
      expect(plugin.isCacheable('api:set-users')).toBe(false);
      expect(plugin.isCacheable('api:delete-users')).toBe(false);
    });

    it('should match suffix wildcard patterns', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        toolPatterns: ['*-readonly'],
      });

      expect(plugin.isCacheable('api-readonly')).toBe(true);
      expect(plugin.isCacheable('cache-readonly')).toBe(true);
      expect(plugin.isCacheable('api-writable')).toBe(false);
    });

    it('should match middle wildcard patterns', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        toolPatterns: ['api:*:list'],
      });

      expect(plugin.isCacheable('api:users:list')).toBe(true);
      expect(plugin.isCacheable('api:orders:list')).toBe(true);
      expect(plugin.isCacheable('api:users:get')).toBe(false);
    });

    it('should match multiple patterns', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        toolPatterns: ['mintlify:*', 'local:ping', 'api:get-*'],
      });

      expect(plugin.isCacheable('mintlify:Search')).toBe(true);
      expect(plugin.isCacheable('local:ping')).toBe(true);
      expect(plugin.isCacheable('api:get-users')).toBe(true);
      expect(plugin.isCacheable('local:echo')).toBe(false);
      expect(plugin.isCacheable('api:set-users')).toBe(false);
    });

    it('should escape special regex characters in patterns', () => {
      const plugin = new CachePlugin({
        type: 'memory',
        toolPatterns: ['api.v1:get-users', 'api[2]:*'],
      });

      // Exact match with dot (should be escaped)
      expect(plugin.isCacheable('api.v1:get-users')).toBe(true);
      expect(plugin.isCacheable('apiXv1:get-users')).toBe(false);

      // Pattern with brackets (should be escaped)
      expect(plugin.isCacheable('api[2]:list')).toBe(true);
      expect(plugin.isCacheable('api[2]:get')).toBe(true);
    });
  });
});
