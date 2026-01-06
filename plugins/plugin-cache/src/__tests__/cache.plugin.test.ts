import 'reflect-metadata';
import type { ProviderFactoryType } from '@frontmcp/sdk';
import CachePlugin from '../cache.plugin';
import { CacheStoreToken } from '../cache.symbol';
import CacheRedisProvider from '../providers/cache-redis.provider';
import CacheMemoryProvider from '../providers/cache-memory.provider';
import CacheVercelKvProvider from '../providers/cache-vercel-kv.provider';

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

        expect(providers).toHaveLength(1);
        expect(providers[0].name).toBe('cache:memory');
        expect(providers[0].provide).toBe(CacheStoreToken);
        expect(providers[0].useValue).toBeInstanceOf(CacheMemoryProvider);
      });

      it('should create memory provider with custom TTL', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'memory',
          defaultTTL: 7200,
        });

        expect(providers).toHaveLength(1);
        expect(providers[0].useValue).toBeInstanceOf(CacheMemoryProvider);
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

        expect(providers).toHaveLength(1);
        expect(providers[0].name).toBe('cache:redis');
        expect(providers[0].provide).toBe(CacheStoreToken);
        expect(providers[0].useValue).toBeInstanceOf(CacheRedisProvider);
      });

      it('should create redis provider with defaultTTL', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'redis',
          config: { host: 'localhost', port: 6379 },
          defaultTTL: 3600,
        });

        expect(providers).toHaveLength(1);
        expect(providers[0].useValue).toBeInstanceOf(CacheRedisProvider);
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

        expect(providers).toHaveLength(1);
        expect(providers[0].name).toBe('cache:redis');
        expect(providers[0].useValue).toBeInstanceOf(CacheRedisProvider);
      });
    });

    describe('type: global-store', () => {
      it('should create provider with inject and useFactory', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });
        const provider = providers[0] as ProviderFactoryType<any, any>;

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
        const provider = providers[0] as ProviderFactoryType<any, any>;
        const tokens = provider.inject();

        expect(tokens).toHaveLength(1);
        expect(typeof tokens[0]).toBe('symbol');
      });

      it('should create Vercel KV provider when global config is vercel-kv', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'global-store',
          defaultTTL: 1800,
        });

        const factory = providers[0].useFactory as (config: any) => any;
        const mockConfig = {
          redis: {
            provider: 'vercel-kv',
            url: 'https://kv.vercel.com',
            token: 'secret-token',
            keyPrefix: 'app:',
          },
        };

        const result = factory(mockConfig);
        expect(result).toBeInstanceOf(CacheVercelKvProvider);
      });

      it('should create Redis provider when global config is redis', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'global-store',
          defaultTTL: 3600,
        });

        const factory = providers[0].useFactory as (config: any) => any;
        const mockConfig = {
          redis: {
            provider: 'redis',
            host: 'redis.example.com',
            port: 6380,
            password: 'secret',
            db: 2,
          },
        };

        const result = factory(mockConfig);
        expect(result).toBeInstanceOf(CacheRedisProvider);
      });

      it('should create Redis provider for legacy config without provider field', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });

        const factory = providers[0].useFactory as (config: any) => any;
        const mockConfig = {
          redis: {
            host: 'legacy-host',
            port: 6379,
          },
        };

        const result = factory(mockConfig);
        expect(result).toBeInstanceOf(CacheRedisProvider);
      });

      it('should throw GlobalConfigNotFoundError when redis is not configured', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });
        const factory = providers[0].useFactory as (config: any) => any;

        expect(() => factory({ redis: undefined })).toThrow(
          'Plugin "CachePlugin" requires global "redis" configuration',
        );
      });

      it('should throw GlobalConfigNotFoundError when config has no redis', () => {
        const providers = CachePlugin.dynamicProviders({ type: 'global-store' });
        const factory = providers[0].useFactory as (config: any) => any;

        expect(() => factory({})).toThrow('Plugin "CachePlugin" requires global "redis" configuration');
      });

      it('should pass defaultTTL to Vercel KV provider', () => {
        const providers = CachePlugin.dynamicProviders({
          type: 'global-store',
          defaultTTL: 7200,
        });

        const factory = providers[0].useFactory as (config: any) => any;
        const mockConfig = {
          redis: {
            provider: 'vercel-kv',
          },
        };

        const result = factory(mockConfig) as CacheVercelKvProvider;
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
  });
});
