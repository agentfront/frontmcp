import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryStorage, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import type { FrontMcpLogger } from '../../common';
import { peopleKeepSessionsInSqlite } from '../http-route.table';
import { openPeopleSessionStore, peopleStoreBackend } from '../people-session-store';

const REDIS = { host: 'localhost', port: 6379 };
const SQLITE = { path: join(tmpdir(), 'people-session-store.sqlite') };

function logger(): FrontMcpLogger & { warn: jest.Mock } {
  return { warn: jest.fn() } as unknown as FrontMcpLogger & { warn: jest.Mock };
}

describe('peopleStoreBackend', () => {
  const tokenStorage = createMemoryStorage();

  it.each([
    ['the server redis first', { redis: REDIS, sqlite: SQLITE, tokenStorage }, 'redis'],
    ['the server sqlite without a redis', { sqlite: SQLITE, tokenStorage }, 'sqlite'],
    ['the sqlite when the redis is Vercel KV', { redis: { provider: 'vercel-kv' }, sqlite: SQLITE }, 'sqlite'],
    ['auth.tokenStorage without either', { tokenStorage }, 'auth.tokenStorage'],
    ['none without a store', {}, undefined],
  ])('picks %s', (_case, sources, backend) => {
    expect(peopleStoreBackend({}, sources)).toBe(backend);
  });

  it('picks none under store: false', () => {
    expect(peopleStoreBackend({ store: false }, { redis: REDIS, sqlite: SQLITE, tokenStorage })).toBeUndefined();
  });
});

describe('openPeopleSessionStore', () => {
  it('keeps sessions in memory without a store, and warns once, naming store: false', async () => {
    const log = logger();

    expect(await openPeopleSessionStore({}, {}, 'desk', log)).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toContain('a restart signs everyone out');
    expect(log.warn.mock.calls[0][0]).toContain('store: false');
  });

  it('keeps sessions in memory under store: false without a warning', async () => {
    const log = logger();

    expect(await openPeopleSessionStore({ store: false }, { sqlite: SQLITE }, 'desk', log)).toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("keeps sessions in auth.tokenStorage under the server's own prefix, and leaves it open", async () => {
    const tokenStorage = createMemoryStorage();
    await tokenStorage.connect();

    const kept = await openPeopleSessionStore({}, { tokenStorage }, 'desk', logger());
    await kept?.store.set('session:abc', '{}');
    await kept?.close();

    expect(kept?.backend).toBe('auth.tokenStorage');
    expect(await tokenStorage.keys()).toEqual(['mcp:people:desk:session:abc']);
    expect(await tokenStorage.ping()).toBe(true);
  });

  it('keeps sessions in memory when the store cannot be opened, and says why', async () => {
    const log = logger();
    const dir = await mkdtemp(join(tmpdir(), 'people-store-'));
    const notAFolder = join(dir, 'file');
    await writeFile(notAFolder, '');

    try {
      expect(await openPeopleSessionStore({}, { sqlite: { path: join(notAFolder, 'kept.sqlite') } }, 'desk', log)).toBe(
        undefined,
      );
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('the sqlite store cannot be opened'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('peopleKeepSessionsInSqlite', () => {
  type ScopeArg = Parameters<typeof peopleKeepSessionsInSqlite>[0];
  const scopeWith = (metadata: Record<string, unknown>) => ({ metadata }) as unknown as ScopeArg;

  it.each([
    ['people auth with the server sqlite', { http: { auth: { people: 'loopback-token' } } }, true],
    ['people auth under store: false', { http: { auth: { people: { mode: 'loopback-token', store: false } } } }, false],
    ['people auth with a server redis', { redis: REDIS, http: { auth: { people: 'loopback-token' } } }, false],
    ['no people auth', {}, false],
  ])('answers for %s', (_case, metadata, expected) => {
    expect(peopleKeepSessionsInSqlite(scopeWith(metadata), SQLITE)).toBe(expected);
  });
});
