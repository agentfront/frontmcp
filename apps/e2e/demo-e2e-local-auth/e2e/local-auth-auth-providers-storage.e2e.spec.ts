/**
 * authProvidersVault keeps the credentials it acquires in the server's Redis or SQLite `auth.tokenStorage`, encrypted,
 * so a credential acquired before a restart is served after it; with `useSharedStorage: false` each process keeps its own.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, McpTestClient, TestServer } from '@frontmcp/testing';

import { signInWithApiKey } from './sign-in';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.auth-providers.ts';
const JWT_SECRET = 'auth-providers-e2e-jwt-secret-32-bytes-min';
const VAULT_SECRET = 'auth-providers-e2e-vault-secret-32-bytes';

describe('authProvidersVault on a local-mode server with a SQLite auth.tokenStorage', () => {
  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'frontmcp-auth-providers-'));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function startServer(instanceName: string, sqlitePath: string, extraEnv: Record<string, string>, port?: number) {
    return TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      port,
      startupTimeout: 60000,
      debug: process.env['DEBUG'] === '1',
      env: {
        INSTANCE_NAME: instanceName,
        TOKEN_STORAGE_SQLITE_PATH: sqlitePath,
        JWT_SECRET,
        VAULT_SECRET,
        ...extraEnv,
      },
    });
  }

  async function githubTokenOf(baseUrl: string, accessToken: string): Promise<unknown> {
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token: accessToken },
    }).buildAndConnect();
    try {
      return (await client.tools.call('read-github-credential', {})).json<{ token: unknown }>().token;
    } finally {
      await client.disconnect();
    }
  }

  /** The GitHub token a user gets from a server, then from a second server started on the same port and file. */
  async function githubTokensAcrossARestart(sqlitePath: string, extraEnv: Record<string, string> = {}) {
    const first = await startServer('first', sqlitePath, extraEnv);
    const port = first.info.port;
    let accessToken: string;
    let beforeRestart: unknown;
    try {
      accessToken = await signInWithApiKey(first.info.baseUrl, {
        clientId: 'auth-providers-client',
        redirectUri: 'http://127.0.0.1:9879/callback',
        apiKey: 'sk-test-auth-providers',
      });
      beforeRestart = await githubTokenOf(first.info.baseUrl, accessToken);
    } finally {
      await first.stop();
    }

    const second = await startServer('second', sqlitePath, extraEnv, port);
    try {
      return { beforeRestart, afterRestart: await githubTokenOf(second.info.baseUrl, accessToken) };
    } finally {
      await second.stop();
    }
  }

  it('serves a credential acquired before a restart after it, and writes it encrypted', async () => {
    const sqlitePath = join(directory, 'shared.sqlite');

    expect(await githubTokensAcrossARestart(sqlitePath)).toEqual({
      beforeRestart: 'github-first-1',
      afterRestart: 'github-first-1',
    });
    const storedBytes = [sqlitePath, `${sqlitePath}-wal`]
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file).toString('latin1'))
      .join('');
    expect(storedBytes).not.toContain('github-first-1');
  }, 180000);

  it('acquires the credential again after a restart with useSharedStorage: false', async () => {
    expect(
      await githubTokensAcrossARestart(join(directory, 'not-shared.sqlite'), {
        AUTH_PROVIDERS_SHARED_STORAGE: 'false',
      }),
    ).toEqual({ beforeRestart: 'github-first-1', afterRestart: 'github-second-1' });
  }, 180000);
});
