/**
 * E2E: the rows of codes and refresh tokens in a persistent `auth.tokenStorage` are named by a keyed hash, never by
 * the value (#1504), on an encrypted SQLite file and on a Redis Cluster shared by two instances; and a refresh token
 * a 1.13 server stored under its old name still refreshes after the upgrade, once.
 *
 * The Redis Cluster cases run when REDIS_CLUSTER_NODES lists the cluster's nodes (`host:port,...`), as
 * `scripts/redis-cluster-docker.sh up` prints; skipped otherwise.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Cluster } from 'ioredis';

import { buildRefreshTokenRecord, createTokenStorageAdapter } from '@frontmcp/auth';
import { expect, TestServer } from '@frontmcp/testing';

import { grantRefreshToken, refreshAt } from './sign-in';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.ts';
const CLIENT_ID = 'row-names-client';
const REDIRECT_URI = 'http://127.0.0.1:9876/callback';
const GRANT = { clientId: CLIENT_ID, redirectUri: REDIRECT_URI };
const JWT_SECRET = 'token-storage-rows-e2e-jwt-secret-32-bytes';
const SQLITE_SECRET = 'token-storage-rows-e2e-sqlite-secret-32b';

function startServer(env: Record<string, string>): Promise<TestServer> {
  return TestServer.start({
    command: `npx tsx ${SERVER_ENTRY}`,
    project: 'demo-e2e-local-auth',
    startupTimeout: 60000,
    debug: process.env['DEBUG'] === '1',
    env: { JWT_SECRET, ...env },
  });
}

/** A refresh token record as a 1.13 server stored it, for the server's anonymous operator. */
function legacyRefreshRecord() {
  return buildRefreshTokenRecord({
    clientId: CLIENT_ID,
    userSub: 'local-operator',
    scopes: ['read'],
    clientAuthMethod: 'none',
  });
}

describe('auth.tokenStorage row names on an encrypted SQLite file (#1504)', () => {
  let directory: string;
  let sqlitePath: string;
  const env = () => ({ TOKEN_STORAGE_SQLITE_PATH: sqlitePath, TOKEN_STORAGE_SQLITE_SECRET: SQLITE_SECRET });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'frontmcp-token-storage-rows-'));
    sqlitePath = join(directory, 'auth-tokens.sqlite');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /** The contents of the database files, the WAL included: what a copy of them shows without the secret. */
  function fileContents(): string[] {
    return readdirSync(directory).map((file) => readFileSync(join(directory, file)).toString('latin1'));
  }

  /** The values among `values` that some byte of the database files still holds. */
  function valuesInFiles(values: string[]): string[] {
    const contents = fileContents();
    // The rows are there: their names are readable, only not what they hold.
    expect(contents.some((content) => content.includes('oauth:refresh:'))).toBe(true);
    return values.filter((value) => contents.some((content) => content.includes(value)));
  }

  it('keeps no code or refresh token in the file, and refreshes after a restart', async () => {
    const first = await startServer(env());
    let values: string[];
    let latest: string;
    try {
      const { code, refreshToken } = await grantRefreshToken(first.info.baseUrl, GRANT);
      const refreshed = await refreshAt(first.info.baseUrl, CLIENT_ID, refreshToken);
      expect(refreshed.status).toBe(200);
      latest = ((await refreshed.json()) as { refresh_token: string }).refresh_token;
      values = [code, refreshToken, latest];
    } finally {
      await first.stop();
    }

    expect(valuesInFiles(values)).toEqual([]);

    const second = await startServer(env());
    try {
      expect((await refreshAt(second.info.baseUrl, CLIENT_ID, latest)).status).toBe(200);
    } finally {
      await second.stop();
    }
  }, 180000);

  it('refreshes a refresh token a 1.13 server stored under its old name once, and moves its row', async () => {
    const record = legacyRefreshRecord();
    const tokenStorage = { sqlite: { path: sqlitePath, encryption: { secret: SQLITE_SECRET } } };
    const seed = await createTokenStorageAdapter(tokenStorage);
    try {
      await seed.set(`oauth:refresh:${record.token}`, JSON.stringify(record), { ttlSeconds: 600 });
    } finally {
      await seed.disconnect();
    }

    const server = await startServer(env());
    try {
      const results = await Promise.all([
        refreshAt(server.info.baseUrl, CLIENT_ID, record.token),
        refreshAt(server.info.baseUrl, CLIENT_ID, record.token),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 400]);
    } finally {
      await server.stop();
    }

    expect(valuesInFiles([record.token])).toEqual([]);
  }, 180000);
});

const CLUSTER_NODES = (process.env['REDIS_CLUSTER_NODES'] ?? '')
  .split(',')
  .map((node) => node.trim())
  .filter(Boolean);
const describeCluster = CLUSTER_NODES.length > 0 ? describe : describe.skip;

describeCluster('auth.tokenStorage row names on a Redis Cluster shared by two instances (#1504)', () => {
  const keyPrefix = `token-storage-rows-e2e:${Date.now()}:`;
  const env = { TOKEN_STORAGE_REDIS_CLUSTER: CLUSTER_NODES.join(','), TOKEN_STORAGE_REDIS_PREFIX: keyPrefix };
  let cluster: Cluster;
  // Each server is kept as soon as it starts, so one that started before another failed to is still stopped.
  const servers: TestServer[] = [];

  beforeAll(async () => {
    const [host, port] = CLUSTER_NODES[0].split(':');
    cluster = new Cluster([{ host, port: Number(port) }]);
    for (let i = 0; i < 2; i += 1) servers.push(await startServer(env));
  }, 180000);

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    for (const key of await keysOnCluster()) await cluster.del(key);
    cluster.disconnect();
  });

  /** Every key under this spec's prefix, on every master. */
  async function keysOnCluster(): Promise<string[]> {
    const perMaster = await Promise.all(cluster.nodes('master').map((node) => node.keys(`${keyPrefix}*`)));
    return perMaster.flat();
  }

  it('lists no key that names a code or refresh token, and rotates a token once across instances', async () => {
    const [a, b] = servers.map((server) => server.info.baseUrl);
    const { code, refreshToken } = await grantRefreshToken(a, GRANT);

    const results = await Promise.all([refreshAt(a, CLIENT_ID, refreshToken), refreshAt(b, CLIENT_ID, refreshToken)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 400]);
    const latest = ((await results.find((response) => response.status === 200)?.json()) as { refresh_token: string })
      .refresh_token;

    const keys = await keysOnCluster();
    expect(keys.some((key) => key.startsWith(`${keyPrefix}oauth:refresh:`))).toBe(true);
    expect(keys.filter((key) => [code, refreshToken, latest].some((value) => key.includes(value)))).toEqual([]);
    expect((await refreshAt(b, CLIENT_ID, latest)).status).toBe(200);
  });

  it('refreshes a refresh token a 1.13 server stored under its old name on the other instance, and moves it', async () => {
    const record = legacyRefreshRecord();
    const legacyKey = `${keyPrefix}oauth:refresh:${record.token}`;
    await cluster.set(legacyKey, JSON.stringify(record), 'EX', 600);

    expect((await refreshAt(servers[1].info.baseUrl, CLIENT_ID, record.token)).status).toBe(200);
    expect((await refreshAt(servers[0].info.baseUrl, CLIENT_ID, record.token)).status).toBe(400);
    expect(await cluster.exists(legacyKey)).toBe(0);
  });
});
