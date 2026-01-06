// file: plugins/plugin-remember/src/__tests__/remember.plugin.test.ts

import 'reflect-metadata';
import RememberPlugin from '../remember.plugin';
import { RememberStoreToken, RememberConfigToken, RememberAccessorToken } from '../remember.symbols';
import RememberMemoryProvider from '../providers/remember-memory.provider';
import RememberRedisProvider from '../providers/remember-redis.provider';
import RememberVercelKvProvider from '../providers/remember-vercel-kv.provider';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    quit: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
  }));
});

// Mock @vercel/kv
jest.mock('@vercel/kv', () => ({
  kv: {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
  },
  createClient: jest.fn().mockReturnValue({
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
  }),
}));

// Helper types
type ValueProvider = { name: string; provide: symbol; useValue: unknown };
type FactoryProvider = {
  name: string;
  provide: symbol;
  inject?: () => unknown[];
  useFactory: (...args: unknown[]) => unknown;
};

describe('RememberPlugin', () => {
  describe('defaultOptions', () => {
    it('should have memory as default type', () => {
      expect(RememberPlugin.defaultOptions.type).toBe('memory');
    });

    it('should have remember: as default key prefix', () => {
      expect(RememberPlugin.defaultOptions.keyPrefix).toBe('remember:');
    });

    it('should have encryption enabled by default', () => {
      expect(RememberPlugin.defaultOptions.encryption?.enabled).toBe(true);
    });
  });

  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const plugin = new RememberPlugin();
      expect(plugin.options.type).toBe('memory');
      expect(plugin.options.keyPrefix).toBe('remember:');
    });

    it('should merge provided options with defaults', () => {
      const plugin = new RememberPlugin({
        type: 'memory',
        keyPrefix: 'custom:',
        defaultTTL: 3600,
      });
      expect(plugin.options.type).toBe('memory');
      expect(plugin.options.keyPrefix).toBe('custom:');
      expect(plugin.options.defaultTTL).toBe(3600);
    });
  });

  describe('dynamicProviders', () => {
    describe('type: memory', () => {
      it('should create memory provider', () => {
        const providers = RememberPlugin.dynamicProviders({ type: 'memory' });
        const storeProvider = providers.find((p) => p.name === 'remember:store:memory') as ValueProvider;

        expect(storeProvider).toBeDefined();
        expect(storeProvider.provide).toBe(RememberStoreToken);
        expect(storeProvider.useValue).toBeInstanceOf(RememberMemoryProvider);
      });

      it('should use memory as default type', () => {
        const providers = RememberPlugin.dynamicProviders({});
        const storeProvider = providers.find((p) => p.name === 'remember:store:memory');
        expect(storeProvider).toBeDefined();
      });
    });

    describe('type: redis', () => {
      it('should create redis provider with config', () => {
        const providers = RememberPlugin.dynamicProviders({
          type: 'redis',
          config: {
            host: 'localhost',
            port: 6379,
            password: 'secret',
          },
        });
        const storeProvider = providers.find((p) => p.name === 'remember:store:redis') as ValueProvider;

        expect(storeProvider).toBeDefined();
        expect(storeProvider.provide).toBe(RememberStoreToken);
        expect(storeProvider.useValue).toBeInstanceOf(RememberRedisProvider);
      });

      it('should not create provider when config is missing', () => {
        const providers = RememberPlugin.dynamicProviders({
          type: 'redis',
        } as any);
        const storeProvider = providers.find((p) => p.name === 'remember:store:redis');
        expect(storeProvider).toBeUndefined();
      });
    });

    describe('type: redis-client', () => {
      it('should create redis provider with existing client', () => {
        const mockClient = {
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          exists: jest.fn(),
          keys: jest.fn(),
          on: jest.fn(),
        };

        const providers = RememberPlugin.dynamicProviders({
          type: 'redis-client',
          client: mockClient as any,
        });
        const storeProvider = providers.find((p) => p.name === 'remember:store:redis-client') as ValueProvider;

        expect(storeProvider).toBeDefined();
        expect(storeProvider.useValue).toBeInstanceOf(RememberRedisProvider);
      });

      it('should not create provider when client is missing', () => {
        const providers = RememberPlugin.dynamicProviders({
          type: 'redis-client',
        } as any);
        const storeProvider = providers.find((p) => p.name === 'remember:store:redis-client');
        expect(storeProvider).toBeUndefined();
      });
    });

    describe('type: vercel-kv', () => {
      it('should create vercel-kv provider', () => {
        const providers = RememberPlugin.dynamicProviders({
          type: 'vercel-kv',
          url: 'https://kv.vercel.com',
          token: 'secret-token',
        });
        const storeProvider = providers.find((p) => p.name === 'remember:store:vercel-kv') as ValueProvider;

        expect(storeProvider).toBeDefined();
        expect(storeProvider.provide).toBe(RememberStoreToken);
        expect(storeProvider.useValue).toBeInstanceOf(RememberVercelKvProvider);
      });

      it('should create vercel-kv provider with default settings', () => {
        const providers = RememberPlugin.dynamicProviders({ type: 'vercel-kv' });
        const storeProvider = providers.find((p) => p.name === 'remember:store:vercel-kv');
        expect(storeProvider).toBeDefined();
      });
    });

    describe('type: global-store', () => {
      it('should create provider with inject and useFactory', () => {
        const providers = RememberPlugin.dynamicProviders({ type: 'global-store' });
        const storeProvider = providers.find((p) => p.name === 'remember:store:global') as FactoryProvider;

        expect(storeProvider).toBeDefined();
        expect(storeProvider.provide).toBe(RememberStoreToken);
        expect(typeof storeProvider.inject).toBe('function');
        expect(typeof storeProvider.useFactory).toBe('function');
      });

      it('should create Vercel KV provider when global config is vercel-kv', () => {
        const providers = RememberPlugin.dynamicProviders({
          type: 'global-store',
          keyPrefix: 'test:',
          defaultTTL: 1800,
        });
        const storeProvider = providers.find((p) => p.name === 'remember:store:global') as FactoryProvider;

        const mockConfig = {
          redis: {
            provider: 'vercel-kv',
            url: 'https://kv.vercel.com',
            token: 'secret-token',
          },
        };

        const result = storeProvider.useFactory(mockConfig);
        expect(result).toBeInstanceOf(RememberVercelKvProvider);
      });

      it('should create Redis provider when global config is redis', () => {
        const providers = RememberPlugin.dynamicProviders({ type: 'global-store' });
        const storeProvider = providers.find((p) => p.name === 'remember:store:global') as FactoryProvider;

        const mockConfig = {
          redis: {
            provider: 'redis',
            host: 'redis.example.com',
            port: 6380,
            password: 'secret',
            db: 2,
          },
        };

        const result = storeProvider.useFactory(mockConfig);
        expect(result).toBeInstanceOf(RememberRedisProvider);
      });

      it('should throw when redis config is missing', () => {
        const providers = RememberPlugin.dynamicProviders({ type: 'global-store' });
        const storeProvider = providers.find((p) => p.name === 'remember:store:global') as FactoryProvider;

        expect(() => storeProvider.useFactory({})).toThrow('requires global "redis" configuration');
      });
    });

    describe('config provider', () => {
      it('should always include config provider', () => {
        const providers = RememberPlugin.dynamicProviders({ type: 'memory' });
        const configProvider = providers.find((p) => p.name === 'remember:config') as ValueProvider;

        expect(configProvider).toBeDefined();
        expect(configProvider.provide).toBe(RememberConfigToken);
        expect(configProvider.useValue).toMatchObject({
          type: 'memory',
          keyPrefix: 'remember:',
        });
      });
    });

    describe('accessor provider', () => {
      it('should always include accessor provider', () => {
        const providers = RememberPlugin.dynamicProviders({ type: 'memory' });
        const accessorProvider = providers.find((p) => p.name === 'remember:accessor') as FactoryProvider;

        expect(accessorProvider).toBeDefined();
        expect(accessorProvider.provide).toBe(RememberAccessorToken);
        expect(typeof accessorProvider.inject).toBe('function');
        expect(typeof accessorProvider.useFactory).toBe('function');
      });
    });
  });
});
