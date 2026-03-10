import { getGlobalStoreConfig } from '../global-config.utils';
import { GlobalConfigNotFoundError } from '../../../errors';
import type { FrontMcpConfigType } from '../../metadata';

describe('getGlobalStoreConfig', () => {
  const mockInfo = { name: 'test', version: '1.0.0' };

  it('should return redis config when configured with Redis provider', () => {
    const config = {
      info: mockInfo,
      apps: [],
      redis: {
        provider: 'redis' as const,
        host: 'localhost',
        port: 6379,
        password: 'secret',
        db: 1,
      },
    } as unknown as FrontMcpConfigType;

    const result = getGlobalStoreConfig('TestPlugin', config);

    expect(result).toEqual({
      provider: 'redis',
      host: 'localhost',
      port: 6379,
      password: 'secret',
      db: 1,
    });
  });

  it('should return redis config when configured with Vercel KV provider', () => {
    const config = {
      info: mockInfo,
      apps: [],
      redis: {
        provider: 'vercel-kv' as const,
        url: 'https://kv.vercel.com',
        token: 'secret-token',
        keyPrefix: 'app:',
      },
    } as unknown as FrontMcpConfigType;

    const result = getGlobalStoreConfig('TestPlugin', config);

    expect(result).toEqual({
      provider: 'vercel-kv',
      url: 'https://kv.vercel.com',
      token: 'secret-token',
      keyPrefix: 'app:',
    });
  });

  it('should return redis config when configured with legacy format', () => {
    const config = {
      info: mockInfo,
      apps: [],
      redis: {
        host: 'legacy-host',
        port: 6380,
      },
    } as unknown as FrontMcpConfigType;

    const result = getGlobalStoreConfig('TestPlugin', config);

    expect(result).toEqual({
      host: 'legacy-host',
      port: 6380,
    });
  });

  it('should throw GlobalConfigNotFoundError when redis is not configured', () => {
    const config = {
      info: mockInfo,
      apps: [],
    } as unknown as FrontMcpConfigType;

    expect(() => getGlobalStoreConfig('CachePlugin', config)).toThrow(GlobalConfigNotFoundError);
    expect(() => getGlobalStoreConfig('CachePlugin', config)).toThrow(
      'Plugin "CachePlugin" requires global "redis" configuration.',
    );
  });

  it('should throw GlobalConfigNotFoundError when redis is undefined', () => {
    const config = {
      info: mockInfo,
      apps: [],
      redis: undefined,
    } as unknown as FrontMcpConfigType;

    expect(() => getGlobalStoreConfig('MyPlugin', config)).toThrow(GlobalConfigNotFoundError);
  });

  it('should include plugin name in error message', () => {
    const config = {
      info: mockInfo,
      apps: [],
    } as unknown as FrontMcpConfigType;

    try {
      getGlobalStoreConfig('CustomPlugin', config);
      fail('Expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GlobalConfigNotFoundError);
      expect((error as GlobalConfigNotFoundError).pluginName).toBe('CustomPlugin');
      expect((error as GlobalConfigNotFoundError).configKey).toBe('redis');
    }
  });
});
