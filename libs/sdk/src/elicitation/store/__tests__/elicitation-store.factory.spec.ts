/**
 * Issue #646 — the elicitation factory (a) refused startup whenever the
 * ambient KV_REST_API_URL was set, even next to a real `elicitation.redis`, and
 * (b) logged `type: 'memory'` for a Redis-backed store because the type was
 * guessed from env vars instead of the resolved config.
 */

import { ElicitationNotSupportedError } from '../../../errors/elicitation.error';
import { createElicitationStore } from '../elicitation-store.factory';

const createStorageMock = jest.fn();

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, createStorage: (...args: unknown[]) => createStorageMock(...args) };
});

function fakeStorage() {
  return {
    supportsPubSub: () => true,
    namespace: () => fakeStorage(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('createElicitationStore — backend selection (#646)', () => {
  const original = { kv: process.env['KV_REST_API_URL'], redisUrl: process.env['REDIS_URL'] };

  beforeEach(() => {
    createStorageMock.mockReset();
    createStorageMock.mockResolvedValue(fakeStorage());
    delete process.env['REDIS_URL'];
    delete process.env['REDIS_HOST'];
    delete process.env['UPSTASH_REDIS_REST_URL'];
  });

  afterEach(() => {
    if (original.kv === undefined) delete process.env['KV_REST_API_URL'];
    else process.env['KV_REST_API_URL'] = original.kv;
    if (original.redisUrl === undefined) delete process.env['REDIS_URL'];
    else process.env['REDIS_URL'] = original.redisUrl;
  });

  it('does not throw when KV_REST_API_URL is set next to a real elicitation.redis', async () => {
    process.env['KV_REST_API_URL'] = 'https://kv.example.invalid';
    const { type } = await createElicitationStore({ redis: { provider: 'redis', host: 'redis.internal', port: 6379 } });
    expect(type).toBe('redis');
  });

  it('reports the real type (redis) even without REDIS_URL in the environment', async () => {
    const { type } = await createElicitationStore({ redis: { provider: 'redis', host: 'redis.internal', port: 6379 } });
    expect(type).toBe('redis');
  });

  it('reports upstash for an upstash storage config', async () => {
    const { type } = await createElicitationStore({
      storage: { type: 'upstash', upstash: { url: 'https://u.example.invalid', token: 'x' } } as never,
    });
    expect(type).toBe('upstash');
  });

  it('still throws when the resolved store is vercel-kv', async () => {
    await expect(createElicitationStore({ redis: { provider: 'vercel-kv' } })).rejects.toBeInstanceOf(
      ElicitationNotSupportedError,
    );
  });

  it('still throws when only the ambient KV_REST_API_URL selects the backend', async () => {
    process.env['KV_REST_API_URL'] = 'https://kv.example.invalid';
    await expect(createElicitationStore({})).rejects.toBeInstanceOf(ElicitationNotSupportedError);
  });
});
