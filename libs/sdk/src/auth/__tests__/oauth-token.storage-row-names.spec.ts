/**
 * The token storage names the rows of codes and refresh tokens by a keyed hash, never by the value (#1504), and a
 * code or refresh token a server stored up to 1.13, under its old name, still works after the upgrade.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildCodeRecord,
  buildRefreshTokenRecord,
  createTokenStorageAdapter,
  StorageAuthorizationStore,
  tokenStorageKeyHashSecret,
  type TokenStorageConfig,
} from '@frontmcp/auth';
import { mkdtemp, readdir, readFileBuffer, rm } from '@frontmcp/utils';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  disposeServers,
  httpGet,
  inputValue,
  PKCE_CHALLENGE,
  PKCE_VERIFIER,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext } from '../../common';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

const HOST = 'desk.example.com';
const CLIENT_ID = 'row-names-client';
const REDIRECT = 'http://127.0.0.1:5555/cb';
const ENCRYPTION_SECRET = 'sqlite-encryption-secret-of-32-bytes';
const JWT_SECRET = 'row-names-spec-jwt-secret-of-32-bytes-min';

describe('auth rows in the token storage (#1504)', () => {
  let directory: string;
  let servers: TestFetchServer[];
  const previousJwtSecret = process.env['JWT_SECRET'];

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-auth-row-names-'));
    servers = [];
    delete process.env['JWT_SECRET'];
  });

  afterEach(async () => {
    await disposeServers(servers);
    await rm(directory, { recursive: true, force: true });
    if (previousJwtSecret === undefined) delete process.env['JWT_SECRET'];
    else process.env['JWT_SECRET'] = previousJwtSecret;
  });

  const sqlite = (encryption = true): TokenStorageConfig => ({
    sqlite: {
      path: path.join(directory, 'tokens.sqlite'),
      ...(encryption ? { encryption: { secret: ENCRYPTION_SECRET } } : {}),
    },
  });

  async function startServer(tokenStorage: TokenStorageConfig): Promise<TestFetchServer> {
    const server = await createTestFetchServer({
      info: { name: 'row-names', version: '1.0.0' },
      apps: [DeskApp],
      auth: { mode: 'local', tokenStorage, requireRegisteredClients: false },
    });
    servers.push(server);
    return server;
  }

  async function stop(server: TestFetchServer): Promise<void> {
    await disposeServers([server]);
    servers = servers.filter((s) => s !== server);
  }

  /** Sign in on the login page and return the authorization code. */
  async function signIn(server: TestFetchServer): Promise<string> {
    const page = await httpGet(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT, state: 's' }),
      HOST,
    );
    expect(page.status).toBe(200);
    const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
    const callback = await httpGet(
      server.handler,
      `/oauth/callback?${new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'nour@example.com' })}`,
      HOST,
    );
    expect(callback.status).toBe(302);
    return redirectParams(callback).get('code') ?? '';
  }

  async function token(server: TestFetchServer, form: Record<string, string>) {
    const response = await postForm(server.handler, '/oauth/token', form, HOST);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const exchange = (server: TestFetchServer, code: string) =>
    token(server, {
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_verifier: PKCE_VERIFIER,
    });

  const refresh = (server: TestFetchServer, refreshToken: string) =>
    token(server, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID });

  /** Every key in the SQLite file, read through a storage of its own. */
  async function storedKeys(tokenStorage: TokenStorageConfig): Promise<string[]> {
    const storage = await createTokenStorageAdapter(tokenStorage);
    try {
      return await storage.keys('*');
    } finally {
      await storage.disconnect();
    }
  }

  /** Store a row as a 1.13 server did: named by the value it holds. */
  async function storeLegacyRow(tokenStorage: TokenStorageConfig, name: string, record: object): Promise<void> {
    const storage = await createTokenStorageAdapter(tokenStorage);
    try {
      await storage.set(`oauth:${name}`, JSON.stringify(record), { ttlSeconds: 600 });
    } finally {
      await storage.disconnect();
    }
  }

  function legacyRefreshRecord() {
    return buildRefreshTokenRecord({
      clientId: CLIENT_ID,
      userSub: 'user-1',
      scopes: ['read'],
      resource: `http://${HOST}`,
      clientAuthMethod: 'none',
    });
  }

  it('names no row, and writes no byte of an encrypted file, by the code or a refresh token of a grant', async () => {
    const server = await startServer(sqlite());
    const code = await signIn(server);
    const issued = await exchange(server, code);
    expect(issued.status).toBe(200);
    const first = String(issued.body['refresh_token']);
    const refreshed = await refresh(server, first);
    expect(refreshed.status).toBe(200);
    const second = String(refreshed.body['refresh_token']);
    await stop(server);

    const values = [code, first, second];
    const keys = await storedKeys(sqlite());
    expect(keys.some((key) => key.startsWith('oauth:refresh:'))).toBe(true);
    expect(keys.filter((key) => values.some((value) => key.includes(value)))).toEqual([]);
    for (const file of await readdir(directory)) {
      const contents = (await readFileBuffer(path.join(directory, file))).toString('latin1');
      expect(values.filter((value) => contents.includes(value))).toEqual([]);
    }
  });

  it('refuses the name of a refresh token row as a refresh token, and of a code row as a code', async () => {
    const server = await startServer(sqlite());
    const code = await signIn(server);
    const [codeRow] = (await storedKeys(sqlite())).filter((key) => key.startsWith('oauth:code:'));
    expect((await exchange(server, codeRow.slice('oauth:code:'.length))).body).toMatchObject({
      error: 'invalid_grant',
    });
    const issued = await exchange(server, code);
    expect(issued.status).toBe(200);
    const refreshToken = String(issued.body['refresh_token']);
    const rowNames = (await storedKeys(sqlite()))
      .filter((key) => key.startsWith('oauth:refresh:'))
      .map((key) => key.slice('oauth:refresh:'.length));
    expect(rowNames).toHaveLength(1);

    expect(await refresh(server, rowNames[0])).toEqual({
      status: 400,
      body: expect.objectContaining({ error: 'invalid_grant' }),
    });
    expect((await refresh(server, refreshToken)).status).toBe(200);
  });

  it('refreshes a refresh token a 1.13 server stored, and moves its row under the hashed name', async () => {
    const record = legacyRefreshRecord();
    await storeLegacyRow(sqlite(), `refresh:${record.token}`, record);
    const server = await startServer(sqlite());

    const refreshed = await refresh(server, record.token);

    expect(refreshed.status).toBe(200);
    expect((await refresh(server, record.token)).body).toMatchObject({ error: 'invalid_grant' });
    expect((await refresh(server, String(refreshed.body['refresh_token']))).status).toBe(200);
    await stop(server);
    expect((await storedKeys(sqlite())).filter((key) => key.includes(record.token))).toEqual([]);
  });

  it('redeems a code a 1.13 server stored once', async () => {
    const record = buildCodeRecord({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT,
      scopes: ['read'],
      pkce: { challenge: PKCE_CHALLENGE, method: 'S256' },
      userSub: 'user-1',
      resource: `http://${HOST}`,
      clientAuthMethod: 'none',
    });
    await storeLegacyRow(sqlite(), `code:${record.code}`, record);
    const server = await startServer(sqlite());

    const results = await Promise.all([exchange(server, record.code), exchange(server, record.code)]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    await stop(server);
    expect((await storedKeys(sqlite())).filter((key) => key.includes(record.code))).toEqual([]);
  });

  it('lets one of two concurrent refreshes of a refresh token a 1.13 server stored succeed', async () => {
    const record = legacyRefreshRecord();
    await storeLegacyRow(sqlite(), `refresh:${record.token}`, record);
    const server = await startServer(sqlite());

    const results = await Promise.all([refresh(server, record.token), refresh(server, record.token)]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
  });

  describe('the secret the rows are named with', () => {
    /** Whether a store naming rows with `keyHashSecret` finds the refresh token. */
    async function foundWith(
      tokenStorage: TokenStorageConfig,
      keyHashSecret: string | undefined,
      refreshToken: string,
    ): Promise<boolean> {
      const storage = await createTokenStorageAdapter(tokenStorage);
      try {
        return (await new StorageAuthorizationStore(storage, { keyHashSecret }).getRefreshToken(refreshToken)) !== null;
      } finally {
        await storage.disconnect();
      }
    }

    async function issueRefreshToken(tokenStorage: TokenStorageConfig): Promise<string> {
      const server = await startServer(tokenStorage);
      const issued = await exchange(server, await signIn(server));
      expect(issued.status).toBe(200);
      await stop(server);
      return String(issued.body['refresh_token']);
    }

    it('is the SQLite encryption secret when the file is encrypted, even with JWT_SECRET set', async () => {
      process.env['JWT_SECRET'] = JWT_SECRET;
      const refreshToken = await issueRefreshToken(sqlite());

      expect(tokenStorageKeyHashSecret(sqlite(), JWT_SECRET)).toBe(ENCRYPTION_SECRET);
      expect(await foundWith(sqlite(), ENCRYPTION_SECRET, refreshToken)).toBe(true);
      expect(await foundWith(sqlite(), JWT_SECRET, refreshToken)).toBe(false);
    });

    it('is JWT_SECRET on an unencrypted storage, and a restart with it refreshes', async () => {
      process.env['JWT_SECRET'] = JWT_SECRET;
      const refreshToken = await issueRefreshToken(sqlite(false));

      expect(await foundWith(sqlite(false), JWT_SECRET, refreshToken)).toBe(true);
      expect(await foundWith(sqlite(false), undefined, refreshToken)).toBe(false);
      const restarted = await startServer(sqlite(false));
      expect((await refresh(restarted, refreshToken)).status).toBe(200);
    });

    it('is none without either, and a restart with a new random signing secret still refreshes', async () => {
      const refreshToken = await issueRefreshToken(sqlite(false));

      expect(await foundWith(sqlite(false), undefined, refreshToken)).toBe(true);
      const restarted = await startServer(sqlite(false));
      expect((await refresh(restarted, refreshToken)).status).toBe(200);
    });
  });
});
