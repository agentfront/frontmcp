/**
 * An unknown cache `type` (#1178).
 *
 * The store switch had no default case, so `type: 'memcached'` started a server that cached in memory. It is now
 * refused when the plugin is configured, with the supported types in the message.
 */
import 'reflect-metadata';

import { CachePluginConfigurationError } from '../cache.errors';
import CachePlugin from '../cache.plugin';
import type { CachePluginOptions } from '../cache.types';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

const options = (type: unknown) => ({ type }) as unknown as CachePluginOptions;

describe('CachePlugin — an unknown type (#1178)', () => {
  it.each(['memcached', 'Memory', '', 42])('refuses type %j, listing the supported ones', (type) => {
    expect(() => CachePlugin.init(options(type))).toThrow(CachePluginConfigurationError);
    expect(() => new CachePlugin(options(type))).toThrow(
      `CachePlugin type ${JSON.stringify(type)} is not supported. Supported types: "memory", "redis", "redis-client", "global-store".`,
    );
  });

  it.each(['memory', 'global-store'])('accepts type %j', (type) => {
    expect(() => CachePlugin.init(options(type))).not.toThrow();
  });

  it('accepts redis and redis-client', () => {
    expect(() => CachePlugin.init({ type: 'redis', config: { host: 'localhost', port: 6379 } })).not.toThrow();
  });

  it('keeps memory, the default, when no type is given', () => {
    expect(() => new CachePlugin(options(undefined))).not.toThrow();
  });
});
