/**
 * The authorization store on a real Redis Cluster (#1504): no key names a code or refresh token, a row stored under
 * its old name moves when used, and a code or refresh token is redeemed once across two instances, each command
 * on one key.
 *
 * Runs when REDIS_CLUSTER_NODES lists the cluster's nodes (`host:port,host:port,...`), as
 * `scripts/redis-cluster-docker.sh up` prints; skipped otherwise.
 */
import { type StorageAdapter } from '@frontmcp/utils';

import { StorageAuthorizationStore } from '../storage-authorization.store';
import { createTokenStorageAdapter } from '../token-storage.factory';

const NODES = (process.env['REDIS_CLUSTER_NODES'] ?? '')
  .split(',')
  .map((node) => node.trim())
  .filter(Boolean)
  .map((node) => {
    const [host, port] = node.split(':');
    return { host, port: Number(port) };
  });

const describeCluster = NODES.length > 0 ? describe : describe.skip;

const SECRET = 'a-stable-secret-of-at-least-32-bytes';

describeCluster('StorageAuthorizationStore on a Redis Cluster', () => {
  const keyPrefix = `auth-rows-spec:${Date.now()}:`;
  let instances: StorageAdapter[];
  let stores: StorageAuthorizationStore[];

  beforeAll(async () => {
    instances = await Promise.all(
      [0, 1].map(() => createTokenStorageAdapter({ redis: { cluster: { nodes: NODES }, keyPrefix } })),
    );
    stores = instances.map((storage) => new StorageAuthorizationStore(storage, { keyHashSecret: SECRET }));
  });

  afterAll(async () => {
    const keys = await instances[0].keys('*');
    for (const key of keys) await instances[0].delete(key);
    await Promise.all(instances.map((storage) => storage.disconnect()));
  });

  function codeRecord() {
    return stores[0].createCodeRecord({
      clientId: 'client-1',
      redirectUri: 'https://app.example.com/cb',
      scopes: ['read'],
      pkce: { challenge: 'c'.repeat(43), method: 'S256' },
      userSub: 'user-1',
    });
  }

  function refreshRecord() {
    return stores[0].createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: ['read'] });
  }

  it('lists no key that names a code or refresh token after a grant', async () => {
    const code = codeRecord();
    await stores[0].storeAuthorizationCode(code);
    await stores[1].markCodeUsed(code.code);
    const refresh = refreshRecord();
    await stores[1].storeRefreshToken(refresh);
    await stores[1].markCodeUsed(code.code, refresh.token);
    const rotated = refreshRecord();
    await stores[0].rotateRefreshToken(refresh.token, rotated);

    const keys = await instances[0].keys('*');
    expect(keys.length).toBeGreaterThan(0);
    const values = [code.code, refresh.token, rotated.token];
    expect(keys.filter((key) => values.some((value) => key.includes(value)))).toEqual([]);
    expect(await stores[1].getRefreshToken(rotated.token)).toMatchObject({ previousToken: refresh.token });
  });

  it('rotates a refresh token stored under its old name once across two instances, and moves it', async () => {
    const refresh = refreshRecord();
    await instances[0].set(`oauth:refresh:${refresh.token}`, JSON.stringify(refresh), { ttlSeconds: 60 });
    const successors = Array.from({ length: 6 }, () => refreshRecord());

    const results = await Promise.allSettled(
      successors.map((successor, i) => stores[i % 2].rotateRefreshToken(refresh.token, successor)),
    );
    const live = await Promise.all(successors.map((successor) => stores[0].getRefreshToken(successor.token)));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(live.filter((record) => record !== null)).toHaveLength(1);
    expect(await instances[1].exists(`oauth:refresh:${refresh.token}`)).toBe(false);
    expect(await stores[1].getRefreshToken(refresh.token)).toBeNull();
  });

  it('redeems a code stored under its old name once across two instances', async () => {
    const code = codeRecord();
    await instances[1].set(`oauth:code:${code.code}`, JSON.stringify(code), { ttlSeconds: 60 });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => stores[i % 2].markCodeUsed(code.code)),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await stores[0].getAuthorizationCode(code.code))?.used).toBe(true);
  });

  it('finds no refresh token by the name of its row, on either instance', async () => {
    const refresh = refreshRecord();
    await stores[0].storeRefreshToken(refresh);
    const rowNames = (await instances[1].keys('oauth:refresh:*')).map((key) => key.slice('oauth:refresh:'.length));
    expect(rowNames.length).toBeGreaterThan(0);

    for (const rowName of rowNames) {
      expect(await stores[1].getRefreshToken(rowName)).toBeNull();
      await expect(stores[1].rotateRefreshToken(rowName, refreshRecord())).rejects.toThrow('already rotated');
    }
    expect(await stores[0].getRefreshToken(refresh.token)).toEqual(refresh);
  });
  it('moves the rows stored under their old names with moveLegacyRows', async () => {
    const refresh = refreshRecord();
    const pending = stores[0].createPendingRecord({
      clientId: 'client-1',
      redirectUri: 'https://app.example.com/cb',
      scopes: ['read'],
      pkce: { challenge: 'c'.repeat(43), method: 'S256' },
    });
    await instances[0].set(`oauth:refresh:${refresh.token}`, JSON.stringify(refresh), { ttlSeconds: 60 });
    await instances[0].set(`oauth:pending:${pending.id}`, JSON.stringify(pending), { ttlSeconds: 60 });

    expect(await stores[1].moveLegacyRows()).toBe(2);

    const keys = await instances[0].keys('*');
    expect(keys.filter((key) => key.includes(refresh.token) || key.includes(pending.id))).toEqual([]);
    expect(await stores[0].getRefreshToken(refresh.token)).toEqual(refresh);
    expect(await stores[0].getPendingAuthorization(pending.id)).toEqual(pending);
  });
});
