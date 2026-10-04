import 'reflect-metadata';

import type { Redis as RedisClient } from 'ioredis';

import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import RememberRedisProvider from '../providers/remember-redis.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import RememberVercelKvProvider from '../providers/remember-vercel-kv.provider';
import type { RememberPluginOptions } from '../remember.types';

class RawTextServer {
  readonly entries = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string, ...flags: unknown[]): Promise<string | null> {
    const onlyIfAbsent = flags.includes('NX') || flags.some((flag) => isNxOption(flag));
    if (onlyIfAbsent && this.entries.has(key)) return null;
    this.entries.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.entries.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    return this.entries.has(key) ? 1 : 0;
  }

  async keys(): Promise<string[]> {
    return [...this.entries.keys()];
  }

  async scan(): Promise<[number, string[]]> {
    return [0, [...this.entries.keys()]];
  }

  rewriteAsUnencodedText(): void {
    for (const [key, value] of this.entries) this.entries.set(key, JSON.parse(value) as string);
  }
}

function isNxOption(flag: unknown): boolean {
  return typeof flag === 'object' && flag !== null && (flag as { nx?: boolean }).nx === true;
}

const vercelKvServer = new RawTextServer();
const createVercelKvClient = jest.fn((config: { url: string; token: string }) => {
  void config;
  return vercelKvServer;
});

jest.mock('@vercel/kv', () => ({
  createClient: (config: { url: string; token: string }) => createVercelKvClient(config),
}));

const context = {
  sessionId: 'session-1',
  authInfo: { sessionId: 'session-1', clientId: 'client-1', extra: { userId: 'user-1' } },
  flow: { name: 'tool' },
} as unknown as FrontMcpContext;

function accessorOver(store: RememberStoreInterface, encrypted: boolean): RememberAccessor {
  const config: RememberPluginOptions = {
    type: 'memory',
    keyPrefix: 'remember:',
    encryption: encrypted ? { enabled: true, customKey: 'k'.repeat(32) } : { enabled: false },
    skipLegacyPurge: true,
  };
  return new RememberAccessor(store, context, config);
}

describe('remember stores keep a stored value intact', () => {
  const jsonLookingText = '{"theme":"dark"}';

  describe('RememberRedisProvider', () => {
    let server: RawTextServer;
    let store: RememberRedisProvider;

    beforeEach(() => {
      server = new RawTextServer();
      store = new RememberRedisProvider({ type: 'redis-client', client: server as unknown as RedisClient });
    });

    it('returns a stored string as the same string', async () => {
      await store.setValue('plain', 'hello');
      await store.setValue('json', jsonLookingText);

      expect(await store.getValue('plain')).toBe('hello');
      expect(await store.getValue('json')).toBe(jsonLookingText);
    });

    it('returns a string written with setIfAbsent as the same string', async () => {
      await store.setIfAbsent('json', jsonLookingText);

      expect(await store.getValue('json')).toBe(jsonLookingText);
    });

    it.each([false, true])('lets remember read back what it wrote (encryption %p)', async (encrypted) => {
      const remember = accessorOver(store, encrypted);
      await remember.set('preferences', { theme: 'dark' });

      expect(await remember.get('preferences')).toEqual({ theme: 'dark' });
    });

    it.each([false, true])('reads entries a previous version stored unencoded (encryption %p)', async (encrypted) => {
      const remember = accessorOver(store, encrypted);
      await remember.set('preferences', { theme: 'dark' });
      server.rewriteAsUnencodedText();

      expect(await remember.get('preferences')).toEqual({ theme: 'dark' });
    });
  });

  describe('RememberVercelKvProvider', () => {
    beforeEach(() => {
      vercelKvServer.entries.clear();
      createVercelKvClient.mockClear();
    });

    it('builds a client that returns values as stored, from options or from the environment', async () => {
      await new RememberVercelKvProvider({ url: 'https://kv.example.com', token: 'token' }).exists('key');
      expect(createVercelKvClient).toHaveBeenLastCalledWith({
        url: 'https://kv.example.com',
        token: 'token',
        automaticDeserialization: false,
      });

      const previousEnvironment = { url: process.env['KV_REST_API_URL'], token: process.env['KV_REST_API_TOKEN'] };
      process.env['KV_REST_API_URL'] = 'https://env.kv.example.com';
      process.env['KV_REST_API_TOKEN'] = 'env-token';
      try {
        await new RememberVercelKvProvider().exists('key');
        expect(createVercelKvClient).toHaveBeenLastCalledWith({
          url: 'https://env.kv.example.com',
          token: 'env-token',
          automaticDeserialization: false,
        });
      } finally {
        restoreEnvironment('KV_REST_API_URL', previousEnvironment.url);
        restoreEnvironment('KV_REST_API_TOKEN', previousEnvironment.token);
      }
    });

    it('returns a stored string as the same string', async () => {
      const store = new RememberVercelKvProvider({ url: 'https://kv.example.com', token: 'token' });
      await store.setValue('json', jsonLookingText);

      expect(await store.getValue('json')).toBe(jsonLookingText);
    });

    it.each([false, true])('lets remember read back what it wrote (encryption %p)', async (encrypted) => {
      const store = new RememberVercelKvProvider({ url: 'https://kv.example.com', token: 'token' });
      const remember = accessorOver(store, encrypted);
      await remember.set('preferences', { theme: 'dark' });

      expect(await remember.get('preferences')).toEqual({ theme: 'dark' });
    });
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
