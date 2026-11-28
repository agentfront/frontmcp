/**
 * No row of the authorization store is named by the value it holds (#1504). Storage encryption seals the values of
 * rows, not their names: a row named `oauth:refresh:<refresh token>` or `oauth:code:<code>` left that value readable to
 * anyone who can list the keys or read the storage file.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { MemoryStorageAdapter, mkdtemp, readdir, readFileBuffer, rm, type StorageAdapter } from '@frontmcp/utils';

import { StorageAuthorizationStore } from '../storage-authorization.store';
import { createTokenStorageAdapter } from '../token-storage.factory';

/** Run a grant as the token endpoint does, and return every value a client presents: the pending id, code and tokens. */
async function runGrant(store: StorageAuthorizationStore): Promise<string[]> {
  const pending = store.createPendingRecord({
    clientId: 'client-1',
    redirectUri: 'https://app.example.com/cb',
    scopes: ['read'],
    pkce: { challenge: 'c'.repeat(43), method: 'S256' },
  });
  await store.storePendingAuthorization(pending);

  const code = store.createCodeRecord({
    clientId: 'client-1',
    redirectUri: 'https://app.example.com/cb',
    scopes: ['read'],
    pkce: { challenge: 'c'.repeat(43), method: 'S256' },
    userSub: 'user-1',
  });
  await store.storeAuthorizationCode(code);
  await store.markCodeUsed(code.code);

  const refresh = store.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: ['read'] });
  await store.storeRefreshToken(refresh);
  await store.markCodeUsed(code.code, refresh.token);

  const rotated = store.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: ['read'] });
  await store.rotateRefreshToken(refresh.token, rotated);

  return [pending.id, code.code, refresh.token, rotated.token];
}

/** The keys that hold one of `values`. */
async function keysHolding(storage: StorageAdapter, values: string[]): Promise<string[]> {
  const keys = await storage.keys('*');
  expect(keys.length).toBeGreaterThan(0);
  return keys.filter((key) => values.some((value) => key.includes(value)));
}

describe('StorageAuthorizationStore row names after a grant (#1504)', () => {
  it('names no row of the memory storage by a code, refresh token or pending id', async () => {
    const storage = new MemoryStorageAdapter();
    await storage.connect();
    try {
      const values = await runGrant(new StorageAuthorizationStore(storage));

      expect(await keysHolding(storage, values)).toEqual([]);
    } finally {
      await storage.disconnect();
    }
  });

  describe('on an encrypted SQLite token storage', () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-auth-row-names-'));
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    it('lists no key, and the file holds no byte, that reveals a code, refresh token or pending id', async () => {
      const storage = await createTokenStorageAdapter({
        sqlite: {
          path: path.join(directory, 'tokens.sqlite'),
          encryption: { secret: 'a-sqlite-encryption-secret-of-32-bytes' },
        },
      });
      let values: string[];
      try {
        values = await runGrant(new StorageAuthorizationStore(storage));

        expect(await keysHolding(storage, values)).toEqual([]);
      } finally {
        await storage.disconnect();
      }

      // What a copy of the database (its WAL included) shows to whoever reads it without the secret.
      const files = await readdir(directory);
      expect(files).toContain('tokens.sqlite');
      for (const file of files) {
        const contents = (await readFileBuffer(path.join(directory, file))).toString('latin1');
        expect(values.filter((value) => contents.includes(value))).toEqual([]);
      }
    });
  });
});
