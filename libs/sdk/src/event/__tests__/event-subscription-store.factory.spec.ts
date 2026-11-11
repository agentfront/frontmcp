import * as os from 'node:os';
import * as path from 'node:path';

import { createStorage, mkdtemp, rm } from '@frontmcp/utils';

import { EventSubscriptionStoreError } from '../../errors';
import { createEventSubscriptionStore, openEventStorage } from '../subscription/event-subscription-store.factory';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, createStorage: jest.fn(actual.createStorage) };
});

const SECRET_NAMES = ['MCP_EVENTS_SECRET', 'MCP_SESSION_SECRET', 'MCP_SERVER_SECRET'];

describe('createEventSubscriptionStore', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of SECRET_NAMES) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of SECRET_NAMES) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  it('keeps subscriptions in memory by default, unencrypted without a secret', async () => {
    const result = await createEventSubscriptionStore();

    expect(result).toMatchObject({ type: 'memory', durable: false, encrypted: false });
    expect(result.storage.prefix).toBe('mcp:events:');
    await result.store.close();
  });

  it.each(SECRET_NAMES)('encrypts with %s when it is set', async (name) => {
    process.env[name] = 'a-secret-for-specs';

    const result = await createEventSubscriptionStore({ keyPrefix: 'spec:' });

    expect(result).toMatchObject({ type: 'memory', encrypted: true });
    expect(result.storage.prefix).toBe('spec:');
    await result.store.close();
  });

  it('opens a SQLite file as a durable, encrypted store', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'events-store-'));
    const logger = { info: jest.fn() };

    const result = await createEventSubscriptionStore({
      sqlite: { path: path.join(directory, 'events.sqlite') },
      secret: 'a-secret-for-specs',
      logger: logger as never,
    });

    expect(result).toMatchObject({ type: 'sqlite', durable: true, encrypted: true });
    expect(logger.info).toHaveBeenCalledWith('Event subscriptions are stored', { type: 'sqlite', encrypted: true });
    await result.store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('refuses a durable store without a secret to encrypt it with', async () => {
    const creation = createEventSubscriptionStore({ sqlite: { path: '/tmp/unused-events.sqlite' } });

    await expect(creation).rejects.toThrow(EventSubscriptionStoreError);
    await expect(creation).rejects.toThrow('set MCP_EVENTS_SECRET (or MCP_SESSION_SECRET / MCP_SERVER_SECRET)');
  });

  it('refuses Vercel KV, which has no compare-and-set', async () => {
    const creation = createEventSubscriptionStore({
      redis: { provider: 'vercel-kv' } as never,
      secret: 'a-secret-for-specs',
    });

    await expect(creation).rejects.toThrow('Vercel KV has no atomic compare-and-set');
  });

  it('opens Redis through its connection options, and says so when it cannot be reached', async () => {
    jest.mocked(createStorage).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const creation = createEventSubscriptionStore({
      redis: { provider: 'redis', host: 'redis.internal', port: 6380, db: 2, tls: true } as never,
      secret: 'a-secret-for-specs',
    });

    await expect(creation).rejects.toThrow('the redis store cannot be opened: connect ECONNREFUSED');
    expect(createStorage).toHaveBeenLastCalledWith({
      type: 'redis',
      redis: { config: { host: 'redis.internal', port: 6380, password: undefined, db: 2, tls: true } },
      prefix: 'mcp:events:',
      fallback: 'error',
    });
  });

  it('reports a failure that is not an Error as text', async () => {
    jest.mocked(createStorage).mockRejectedValueOnce('storage offline');

    await expect(createEventSubscriptionStore()).rejects.toThrow('the memory store cannot be opened: storage offline');
  });
});

describe('openEventStorage', () => {
  it('opens memory storage under the default prefix without a store configured', async () => {
    const storage = await openEventStorage();

    expect(storage.prefix).toBe('mcp:events:');
    await storage.set('published:1', 'kept');
    expect(await storage.get('published:1')).toBe('kept');
    await storage.disconnect();
  });

  it('opens the SQLite file events.store names, without asking for a secret', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'events-storage-'));

    const storage = await openEventStorage({
      sqlite: { path: path.join(directory, 'events.sqlite') },
      keyPrefix: 'spec:',
    });

    expect(storage.prefix).toBe('spec:');
    await storage.disconnect();
    await rm(directory, { recursive: true, force: true });
  });

  it('says so when the store cannot be opened', async () => {
    jest.mocked(createStorage).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const opening = openEventStorage({ redis: { provider: 'redis', host: 'redis.internal', port: 6379 } as never });

    await expect(opening).rejects.toThrow(EventSubscriptionStoreError);
    await expect(opening).rejects.toThrow('the redis store cannot be opened: connect ECONNREFUSED');
  });
});
