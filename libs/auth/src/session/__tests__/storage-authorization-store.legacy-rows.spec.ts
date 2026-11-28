/**
 * Rows a store wrote up to 1.13, named by the value they hold (`oauth:refresh:<token>`), keep working after the
 * upgrade: they are read under that name when the hashed one holds nothing, move under the hashed name when used,
 * and a code or refresh token is still redeemed once, also across instances (#1504).
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { createNamespacedStorage, MemoryStorageAdapter, mkdtemp, rm, type StorageAdapter } from '@frontmcp/utils';

import type { AuthorizationCodeRecord, PendingAuthorizationRecord, RefreshTokenRecord } from '../authorization.store';
import { StorageAuthorizationStore } from '../storage-authorization.store';
import { createTokenStorageAdapter, tokenStorageKeyHashSecret } from '../token-storage.factory';

const SECRET = 'a-stable-secret-of-at-least-32-bytes';

describe('StorageAuthorizationStore rows named up to 1.13', () => {
  let adapter: MemoryStorageAdapter;
  let store: StorageAuthorizationStore;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    store = new StorageAuthorizationStore(adapter, { keyHashSecret: SECRET });
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  function codeRecord(overrides: Partial<AuthorizationCodeRecord> = {}): AuthorizationCodeRecord {
    return {
      ...store.createCodeRecord({
        clientId: 'client-1',
        redirectUri: 'https://app.example.com/cb',
        scopes: ['read'],
        pkce: { challenge: 'c'.repeat(43), method: 'S256' },
        userSub: 'user-1',
      }),
      ...overrides,
    };
  }

  function pendingRecord(overrides: Partial<PendingAuthorizationRecord> = {}): PendingAuthorizationRecord {
    return {
      ...store.createPendingRecord({
        clientId: 'client-1',
        redirectUri: 'https://app.example.com/cb',
        scopes: ['read'],
        pkce: { challenge: 'c'.repeat(43), method: 'S256' },
      }),
      ...overrides,
    };
  }

  function refreshRecord(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
    return {
      ...store.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: ['read'] }),
      ...overrides,
    };
  }

  /** Write a row as 1.13 did: named by the value it holds. */
  async function writeLegacy(storage: StorageAdapter, name: string, record: { expiresAt: number }): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
    await storage.set(`oauth:${name}`, JSON.stringify(record), { ttlSeconds });
  }

  /** The keys of one record type, apart from the given legacy one. */
  async function hashedKeys(storage: StorageAdapter, type: string, legacyValue: string): Promise<string[]> {
    return (await storage.keys(`oauth:${type}:*`)).filter((key) => key !== `oauth:${type}:${legacyValue}`);
  }

  describe('reading', () => {
    it('reads a code, a pending authorization and a refresh token stored under their old names', async () => {
      const code = codeRecord();
      const pending = pendingRecord();
      const refresh = refreshRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);
      await writeLegacy(adapter, `pending:${pending.id}`, pending);
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);

      expect(await store.getAuthorizationCode(code.code)).toEqual(code);
      expect(await store.getPendingAuthorization(pending.id)).toEqual(pending);
      expect(await store.getRefreshToken(refresh.token)).toEqual(refresh);
    });

    it('reads only the row under the hashed name when both names hold one', async () => {
      const refresh = refreshRecord();
      await store.storeRefreshToken({ ...refresh, revoked: true });
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);

      expect(await store.getRefreshToken(refresh.token)).toBeNull();
      await expect(store.rotateRefreshToken(refresh.token, refreshRecord())).rejects.toThrow('already rotated');
      expect(await adapter.exists(`oauth:refresh:${refresh.token}`)).toBe(true);
    });

    it('deletes an expired code stored under its old name when it is read', async () => {
      const code = codeRecord({ expiresAt: Date.now() - 1000 });
      await adapter.set(`oauth:code:${code.code}`, JSON.stringify(code));

      expect(await store.getAuthorizationCode(code.code)).toBeNull();
      expect(await adapter.exists(`oauth:code:${code.code}`)).toBe(false);
    });
  });

  describe('moving on use', () => {
    it('moves a code under its hashed name when it is redeemed, with the refresh token issued from it', async () => {
      const code = codeRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);

      await store.markCodeUsed(code.code);
      await store.markCodeUsed(code.code, 'issued-refresh-token');

      expect(await adapter.exists(`oauth:code:${code.code}`)).toBe(false);
      const moved = await hashedKeys(adapter, 'code', code.code);
      expect(moved).toHaveLength(1);
      expect(moved[0]).not.toContain(code.code);
      expect(JSON.parse((await adapter.get(moved[0])) ?? '{}')).toMatchObject({
        used: true,
        issuedRefreshToken: 'issued-refresh-token',
      });
      expect(await adapter.ttl(moved[0])).toBeGreaterThan(0);
      await expect(store.markCodeUsed(code.code)).rejects.toThrow('already redeemed');
    });

    it('moves a refresh token under its hashed name when it is rotated, and stores its successor hashed', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);
      const successor = refreshRecord();

      await store.rotateRefreshToken(refresh.token, successor);

      expect(await adapter.exists(`oauth:refresh:${refresh.token}`)).toBe(false);
      expect(await store.getRefreshToken(refresh.token)).toBeNull();
      expect((await store.getRefreshToken(successor.token))?.previousToken).toBe(refresh.token);
      const keys = await adapter.keys('oauth:refresh:*');
      expect(keys).toHaveLength(2);
      expect(keys.filter((key) => key.includes(refresh.token) || key.includes(successor.token))).toEqual([]);
      await expect(store.rotateRefreshToken(refresh.token, refreshRecord())).rejects.toThrow('already rotated');
    });

    it('moves a refresh token under its hashed name when it is revoked', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);

      await store.revokeRefreshToken(refresh.token);

      expect(await adapter.exists(`oauth:refresh:${refresh.token}`)).toBe(false);
      const [moved] = await hashedKeys(adapter, 'refresh', refresh.token);
      expect(JSON.parse((await adapter.get(moved)) ?? '{}')).toMatchObject({ revoked: true });
      expect(await store.getRefreshToken(refresh.token)).toBeNull();
    });

    it('stores an updated pending authorization hashed, reads that one, and deletes both rows', async () => {
      const pending = pendingRecord();
      await writeLegacy(adapter, `pending:${pending.id}`, pending);

      await store.storePendingAuthorization({ ...pending, authUiCsrf: 'csrf-1' });
      expect((await store.getPendingAuthorization(pending.id))?.authUiCsrf).toBe('csrf-1');

      await store.deletePendingAuthorization(pending.id);
      expect(await adapter.keys('oauth:pending:*')).toEqual([]);
    });

    it('deletes a code under both names', async () => {
      const code = codeRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);
      await store.storeAuthorizationCode(code);

      await store.deleteAuthorizationCode(code.code);

      expect(await adapter.keys('oauth:code:*')).toEqual([]);
    });
  });

  describe('redeemed once', () => {
    it('lets one of five concurrent token requests redeem a code stored under its old name', async () => {
      const code = codeRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);

      const results = await Promise.allSettled(Array.from({ length: 5 }, () => store.markCodeUsed(code.code)));

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((await store.getAuthorizationCode(code.code))?.used).toBe(true);
    });

    it('lets one of five concurrent rotations of a refresh token stored under its old name succeed', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);
      const successors = Array.from({ length: 5 }, () => refreshRecord());

      const results = await Promise.allSettled(
        successors.map((successor) => store.rotateRefreshToken(refresh.token, successor)),
      );
      const live = await Promise.all(successors.map((successor) => store.getRefreshToken(successor.token)));

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(live.filter((record) => record !== null)).toHaveLength(1);
    });

    it('keeps a refresh token stored under its old name unusable when it is rotated and revoked at once', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);

      await Promise.allSettled([
        store.rotateRefreshToken(refresh.token, refreshRecord()),
        store.revokeRefreshToken(refresh.token),
      ]);

      expect(await store.getRefreshToken(refresh.token)).toBeNull();
      await expect(store.rotateRefreshToken(refresh.token, refreshRecord())).rejects.toThrow('already rotated');
    });

    it('refuses to redeem a code stored under its old name on an adapter that cannot compare and delete', async () => {
      const code = codeRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);
      Object.assign(adapter, { deleteIfEquals: undefined });

      await expect(store.markCodeUsed(code.code)).rejects.toThrow(
        'Use the memory, Redis, Upstash, Vercel KV or SQLite',
      );
      expect(await adapter.exists(`oauth:code:${code.code}`)).toBe(true);
    });
  });

  describe('the key hash secret', () => {
    it('is the SQLite encryption secret, else the server secret, and none for a blank one', () => {
      const encrypted = { sqlite: { path: 'tokens.sqlite', encryption: { secret: 'sqlite-secret' } } };
      const bytes = new TextEncoder().encode(SECRET);

      expect(tokenStorageKeyHashSecret(encrypted, SECRET)).toBe('sqlite-secret');
      expect(tokenStorageKeyHashSecret({ sqlite: { path: 'tokens.sqlite' } }, SECRET)).toBe(SECRET);
      expect(tokenStorageKeyHashSecret({ redis: { host: 'localhost' } }, bytes)).toBe(bytes);
      expect(tokenStorageKeyHashSecret({ redis: { host: 'localhost' } }, '   ')).toBeUndefined();
      expect(tokenStorageKeyHashSecret({ redis: { host: 'localhost' } }, new Uint8Array(0))).toBeUndefined();
      expect(tokenStorageKeyHashSecret(undefined)).toBeUndefined();
    });

    it('finds a row another instance with the same secret stored', async () => {
      const refresh = refreshRecord();
      await store.storeRefreshToken(refresh);

      const sameSecret = new StorageAuthorizationStore(adapter, { keyHashSecret: new TextEncoder().encode(SECRET) });
      expect(await sameSecret.getRefreshToken(refresh.token)).toEqual(refresh);
    });

    it('does not find a row stored under another secret', async () => {
      const refresh = refreshRecord();
      await store.storeRefreshToken(refresh);

      const otherSecret = new StorageAuthorizationStore(adapter, {
        keyHashSecret: 'another-secret-of-at-least-32-bytes',
      });
      expect(await otherSecret.getRefreshToken(refresh.token)).toBeNull();
    });

    it('names rows under a fixed key without a secret, found again by a new instance', async () => {
      const unkeyed = new StorageAuthorizationStore(adapter);
      const refresh = refreshRecord();
      await unkeyed.storeRefreshToken(refresh);

      expect(await new StorageAuthorizationStore(adapter).getRefreshToken(refresh.token)).toEqual(refresh);
      expect((await adapter.keys('*')).filter((key) => key.includes(refresh.token))).toEqual([]);
    });
  });

  describe('moveLegacyRows', () => {
    it('moves every row named by its value, deletes expired ones, and leaves hashed and foreign rows', async () => {
      const code = codeRecord();
      const pending = pendingRecord();
      const refresh = refreshRecord();
      const hashed = refreshRecord();
      const expired = refreshRecord({ expiresAt: Date.now() - 1000 });
      await writeLegacy(adapter, `code:${code.code}`, code);
      await writeLegacy(adapter, `pending:${pending.id}`, pending);
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);
      await adapter.set(`oauth:refresh:${expired.token}`, JSON.stringify(expired));
      await store.storeRefreshToken(hashed);
      await adapter.set('oauth:refresh:not-json', 'plain text');
      await adapter.set('oauth:refresh:another-name', JSON.stringify({ token: 'a-different-token', expiresAt: 0 }));
      await adapter.set('oauth:client:client-1', JSON.stringify({ client_id: 'client-1' }));

      expect(await store.moveLegacyRows()).toBe(3);

      const values = [code.code, pending.id, refresh.token, hashed.token, expired.token];
      expect((await adapter.keys('*')).filter((key) => values.some((value) => key.includes(value)))).toEqual([]);
      expect(await store.getAuthorizationCode(code.code)).toEqual(code);
      expect(await store.getPendingAuthorization(pending.id)).toEqual(pending);
      expect(await store.getRefreshToken(refresh.token)).toEqual(refresh);
      expect(await store.getRefreshToken(hashed.token)).toEqual(hashed);
      expect(await adapter.get('oauth:refresh:not-json')).toBe('plain text');
      expect(await adapter.exists('oauth:refresh:another-name')).toBe(true);
      expect(await adapter.exists('oauth:client:client-1')).toBe(true);
      expect(await store.moveLegacyRows()).toBe(0);
    });

    it('keeps the row already under the hashed name, and deletes the old one', async () => {
      const refresh = refreshRecord();
      await store.storeRefreshToken({ ...refresh, revoked: true });
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);

      await store.moveLegacyRows();

      expect(await adapter.exists(`oauth:refresh:${refresh.token}`)).toBe(false);
      expect(await store.getRefreshToken(refresh.token)).toBeNull();
    });

    it('moves the rows of a store over a NamespacedStorage', async () => {
      const namespaced = createNamespacedStorage(adapter, 'tenant:a');
      const nsStore = new StorageAuthorizationStore(namespaced, { keyHashSecret: SECRET });
      const refresh = refreshRecord();
      await adapter.set(`tenant:a:oauth:refresh:${refresh.token}`, JSON.stringify(refresh), { ttlSeconds: 60 });

      expect(await nsStore.moveLegacyRows()).toBe(1);

      expect((await adapter.keys('*')).filter((key) => key.includes(refresh.token))).toEqual([]);
      expect(await nsStore.getRefreshToken(refresh.token)).toEqual(refresh);
    });
  });

  describe('two instances on one SQLite file', () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-auth-legacy-rows-'));
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    it('redeem a code stored under its old name once, and the second finds it moved', async () => {
      const tokenStorage = {
        sqlite: {
          path: path.join(directory, 'tokens.sqlite'),
          encryption: { secret: 'sqlite-secret-of-32-bytes-min!!' },
        },
      };
      const first = await createTokenStorageAdapter(tokenStorage);
      const second = await createTokenStorageAdapter(tokenStorage);
      try {
        const stores = [first, second].map(
          (storage) => new StorageAuthorizationStore(storage, { keyHashSecret: SECRET }),
        );
        const code = codeRecord();
        await writeLegacy(first, `code:${code.code}`, code);

        const results = await Promise.allSettled([
          stores[0].markCodeUsed(code.code),
          stores[1].markCodeUsed(code.code),
          stores[0].markCodeUsed(code.code),
          stores[1].markCodeUsed(code.code),
        ]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect((await stores[1].getAuthorizationCode(code.code))?.used).toBe(true);
        expect((await second.keys('*')).filter((key) => key.includes(code.code))).toEqual([]);
      } finally {
        await first.disconnect();
        await second.disconnect();
      }
    });
  });
});
