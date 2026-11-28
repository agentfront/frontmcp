/**
 * Rows a store wrote up to 1.13, named by the value they hold (`oauth:refresh:<token>`), keep working after the
 * upgrade: they are read under that name when the hashed one holds nothing, move under the hashed name when used,
 * and a code or refresh token is still redeemed once, also across instances and while its row moves (#1504). A row
 * is read only for the value its record holds, so a hashed name presented as a value finds nothing.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { MemoryStorageAdapter, mkdtemp, rm, type StorageAdapter } from '@frontmcp/utils';

import { AuthorizationRowNames } from '../authorization-row-names';
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

  describe('a row name presented as a value', () => {
    /** The name a store gave the one row of `type`: what a listing of the keys shows. */
    async function rowName(type: string): Promise<string> {
      const keys = await adapter.keys(`oauth:${type}:*`);
      expect(keys).toHaveLength(1);
      return keys[0].slice(`oauth:${type}:`.length);
    }

    it('finds, rotates and revokes no refresh token', async () => {
      const refresh = refreshRecord();
      await store.storeRefreshToken(refresh);
      const name = await rowName('refresh');

      expect(await store.getRefreshToken(name)).toBeNull();
      await expect(store.rotateRefreshToken(name, refreshRecord())).rejects.toThrow('already rotated');
      await store.revokeRefreshToken(name);

      expect(await store.getRefreshToken(refresh.token)).toEqual(refresh);
      expect(await adapter.keys('oauth:refresh:*')).toHaveLength(1);
    });

    it('finds, redeems and deletes no code', async () => {
      const code = codeRecord();
      await store.storeAuthorizationCode(code);
      const name = await rowName('code');

      expect(await store.getAuthorizationCode(name)).toBeNull();
      await expect(store.markCodeUsed(name)).rejects.toThrow('already redeemed');
      await store.markCodeUsed(name, 'issued-refresh-token');
      await store.deleteAuthorizationCode(name);

      expect(await store.getAuthorizationCode(code.code)).toEqual(code);
    });

    it('finds and deletes no pending authorization', async () => {
      const pending = pendingRecord();
      await store.storePendingAuthorization(pending);
      const name = await rowName('pending');

      expect(await store.getPendingAuthorization(name)).toBeNull();
      await store.deletePendingAuthorization(name);

      expect(await store.getPendingAuthorization(pending.id)).toEqual(pending);
    });

    it('reads no row under an old name that holds another record, or none', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, 'refresh:another-value', refresh);
      await adapter.set('oauth:refresh:null-row', 'null');

      expect(await store.getRefreshToken('another-value')).toBeNull();
      await expect(store.rotateRefreshToken('another-value', refreshRecord())).rejects.toThrow('already rotated');
      expect(await store.getRefreshToken('null-row')).toBeNull();
      await expect(store.rotateRefreshToken('null-row', refreshRecord())).rejects.toThrow('already rotated');
    });
  });

  describe('moving on use, interleaved across two instances', () => {
    const hashedName = (type: string, value: string) =>
      `oauth:${type}:${new AuthorizationRowNames(SECRET).name(value)}`;

    /**
     * A store instance over the shared storage, through a wrapper of its own, so a test can hold it at one storage
     * call (before the call runs, or after with `after`) while another instance runs.
     */
    function instance() {
      const holds: Array<{ op: string; key: string; after: boolean; reached: () => void; wait: Promise<void> }> = [];
      const storage = new Proxy(adapter, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof value !== 'function') return value;
          const call = value as (...args: unknown[]) => Promise<unknown>;
          return async (...args: unknown[]) => {
            const index = holds.findIndex((h) => h.op === prop && h.key === args[0]);
            const hold = index >= 0 ? holds.splice(index, 1)[0] : undefined;
            if (hold && !hold.after) {
              hold.reached();
              await hold.wait;
            }
            const result = await call.apply(target, args);
            if (hold?.after) {
              hold.reached();
              await hold.wait;
            }
            return result;
          };
        },
      });
      function holdAt(op: string, key: string, after = false) {
        let reached!: () => void;
        let release!: () => void;
        const isReached = new Promise<void>((resolve) => (reached = resolve));
        const wait = new Promise<void>((resolve) => (release = resolve));
        holds.push({ op, key, after, reached, wait });
        return { reached: isReached, release };
      }
      return { store: new StorageAuthorizationStore(storage, { keyHashSecret: SECRET }), holdAt };
    }

    /** The records among `records` whose token can still be rotated. */
    async function liveTokens(records: RefreshTokenRecord[]): Promise<RefreshTokenRecord[]> {
      const found = await Promise.all(records.map((record) => store.getRefreshToken(record.token)));
      return found.filter((record): record is RefreshTokenRecord => record !== null);
    }

    it('a revocation while a rotation moves the row leaves the old token unusable', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);
      const [a, b] = [instance(), instance()];
      const successor = refreshRecord();
      // A holds between claiming the old row and writing the hashed one: the row is under neither name.
      const held = a.holdAt('set', hashedName('refresh', refresh.token));
      const rotation = a.store.rotateRefreshToken(refresh.token, successor);
      await held.reached;

      await b.store.revokeRefreshToken(refresh.token);
      await expect(b.store.rotateRefreshToken(refresh.token, refreshRecord())).rejects.toThrow('already rotated');
      held.release();
      await rotation;

      expect(await store.getRefreshToken(refresh.token)).toBeNull();
      await expect(store.rotateRefreshToken(refresh.token, refreshRecord())).rejects.toThrow('already rotated');
      expect(await liveTokens([successor])).toHaveLength(1);
      expect(await adapter.exists(`oauth:refresh:${refresh.token}`)).toBe(false);
    });

    it('a rotation while a revocation moves the row is refused', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);
      const [a, b] = [instance(), instance()];
      // B holds after writing the revoked record under the hashed name, before deleting the old row.
      const held = b.holdAt('delete', `oauth:refresh:${refresh.token}`);
      const revocation = b.store.revokeRefreshToken(refresh.token);
      await held.reached;

      const successor = refreshRecord();
      await expect(a.store.rotateRefreshToken(refresh.token, successor)).rejects.toThrow('already rotated');
      held.release();
      await revocation;

      expect(await store.getRefreshToken(refresh.token)).toBeNull();
      expect(await liveTokens([successor])).toEqual([]);
      expect(await adapter.exists(`oauth:refresh:${refresh.token}`)).toBe(false);
    });

    it('a rotation that read the old row before a revocation moved it is refused', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);
      const [a, b] = [instance(), instance()];
      // A has read the old row and holds before its compare-and-delete; B revokes in full meanwhile.
      const held = a.holdAt('deleteIfEquals', `oauth:refresh:${refresh.token}`);
      const successor = refreshRecord();
      const rotation = a.store.rotateRefreshToken(refresh.token, successor);
      await held.reached;

      await b.store.revokeRefreshToken(refresh.token);
      held.release();

      await expect(rotation).rejects.toThrow('already rotated');
      expect(await store.getRefreshToken(refresh.token)).toBeNull();
      expect(await liveTokens([successor])).toEqual([]);
    });

    it('a revocation that read the old row before a rotation moved it still revokes it', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);
      const [a, b] = [instance(), instance()];
      // B has read the live old row and holds before writing; A rotates in full meanwhile.
      const held = b.holdAt('get', `oauth:refresh:${refresh.token}`, true);
      const revocation = b.store.revokeRefreshToken(refresh.token);
      await held.reached;

      const successor = refreshRecord();
      await a.store.rotateRefreshToken(refresh.token, successor);
      held.release();
      await revocation;

      expect(await store.getRefreshToken(refresh.token)).toBeNull();
      await expect(store.rotateRefreshToken(refresh.token, refreshRecord())).rejects.toThrow('already rotated');
      expect(await liveTokens([successor])).toHaveLength(1);
    });

    it('a rotation that missed the hashed name before another instance moved the row is refused', async () => {
      const refresh = refreshRecord();
      await writeLegacy(adapter, `refresh:${refresh.token}`, refresh);
      const [a, b] = [instance(), instance()];
      // A has missed the hashed name and holds before reading the old one; B rotates in full meanwhile.
      const held = a.holdAt('get', `oauth:refresh:${refresh.token}`);
      const late = refreshRecord();
      const rotation = a.store.rotateRefreshToken(refresh.token, late);
      await held.reached;

      const successor = refreshRecord();
      await b.store.rotateRefreshToken(refresh.token, successor);
      held.release();

      await expect(rotation).rejects.toThrow('already rotated');
      expect((await liveTokens([successor, late])).map((record) => record.token)).toEqual([successor.token]);
    });

    it('a read that missed the hashed name finds a code another instance moved there before the old name was read', async () => {
      const code = codeRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);
      const [a, b] = [instance(), instance()];
      // A has missed the hashed name and holds before reading the old one; B redeems the code, moving its row.
      const held = a.holdAt('get', `oauth:code:${code.code}`);
      const read = a.store.getAuthorizationCode(code.code);
      await held.reached;

      await b.store.markCodeUsed(code.code);
      await b.store.markCodeUsed(code.code, 'issued-refresh-token');
      held.release();

      expect(await read).toMatchObject({ code: code.code, used: true, issuedRefreshToken: 'issued-refresh-token' });
    });

    it('a redemption that missed the hashed name redeems a code moved there before the old name was read, once', async () => {
      const code = codeRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);
      const [a, b] = [instance(), instance()];
      // A has missed the hashed name and holds before reading the old one; meanwhile the live row is written under the
      // hashed name, and then the old row is deleted.
      const held = a.holdAt('get', `oauth:code:${code.code}`);
      const redemption = a.store.markCodeUsed(code.code);
      await held.reached;

      await adapter.set(hashedName('code', code.code), JSON.stringify(code), { ttlSeconds: 60 });
      await adapter.delete(`oauth:code:${code.code}`);
      held.release();

      await expect(redemption).resolves.toBeUndefined();
      await expect(b.store.markCodeUsed(code.code)).rejects.toThrow('already redeemed');
      expect((await b.store.getAuthorizationCode(code.code))?.used).toBe(true);
    });

    it('a code redeemed while another instance moves it is redeemed once', async () => {
      const code = codeRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);
      const [a, b] = [instance(), instance()];
      // A holds between claiming the old row and writing the hashed one.
      const held = a.holdAt('set', hashedName('code', code.code));
      const first = a.store.markCodeUsed(code.code);
      await held.reached;

      await expect(b.store.markCodeUsed(code.code)).rejects.toThrow('already redeemed');
      held.release();
      await first;

      await expect(b.store.markCodeUsed(code.code)).rejects.toThrow('already redeemed');
      expect((await b.store.getAuthorizationCode(code.code))?.used).toBe(true);
    });

    it('a code one instance read under its old name and the other redeemed is redeemed once', async () => {
      const code = codeRecord();
      await writeLegacy(adapter, `code:${code.code}`, code);
      const [a, b] = [instance(), instance()];
      // A has read the old row and holds before its compare-and-delete.
      const held = a.holdAt('deleteIfEquals', `oauth:code:${code.code}`);
      const first = a.store.markCodeUsed(code.code);
      await held.reached;

      await b.store.markCodeUsed(code.code);
      held.release();

      await expect(first).rejects.toThrow('already redeemed');
      expect((await a.store.getAuthorizationCode(code.code))?.used).toBe(true);
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
