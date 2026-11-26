/**
 * A CLI signs in at the identity provider with `signInNative` (discovery, S256 PKCE, a loopback redirect), keeps the
 * tokens in a file, calls the transparent-mode server with them, and refreshes them once they expire (#1361).
 * The test plays the browser: it follows the provider's redirect to the loopback listener with an HTTP client.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { fileTokenStore, getNativeTokens, signInNative, type NativeSignInOptions } from '@frontmcp/auth/native';
import { expect, McpTestClient, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';
import { mkdtemp, rm } from '@frontmcp/utils';

const CLIENT_ID = 'tasks-cli';

describe('native sign-in against the identity provider of a transparent server', () => {
  let mockOAuth: MockOAuthServer;
  let server: TestServer;
  let dir: string;
  let options: NativeSignInOptions;

  async function listTools(token: string): Promise<string[]> {
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    try {
      return (await client.tools.list()).map((tool) => tool.name);
    } finally {
      await client.disconnect();
    }
  }

  beforeAll(async () => {
    const probe = new MockOAuthServer(new TestTokenFactory());
    const { port, issuer } = await probe.start();
    await probe.stop();

    mockOAuth = new MockOAuthServer(new TestTokenFactory({ issuer, audience: issuer }), {
      port,
      autoApprove: true,
      testUser: { sub: 'user-native', email: 'native@example.com' },
      clientId: CLIENT_ID,
      validRedirectUris: ['http://127.0.0.1:*/callback'],
      pkce: 'strict',
    });
    await mockOAuth.start();

    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-transparent/src/main.ts',
      env: { IDP_PROVIDER_URL: issuer, IDP_EXPECTED_AUDIENCE: issuer },
      startupTimeout: 30000,
    });

    dir = await mkdtemp(path.join(os.tmpdir(), 'native-sign-in-'));
    options = {
      issuer,
      clientId: CLIENT_ID,
      scopes: ['openid', 'tasks:read'],
      store: fileTokenStore(path.join(dir, 'tokens.json')),
      openBrowser: async (url) => {
        const approved = await fetch(url, { redirect: 'manual' });
        const page = await fetch(approved.headers.get('location') as string);
        expect(page.status).toBe(200);
      },
    };
  }, 60000);

  afterAll(async () => {
    await server?.stop();
    await mockOAuth?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('signs in, and the server accepts the access token', async () => {
    expect(await getNativeTokens(options)).toBeUndefined();

    const tokens = await signInNative(options);

    expect(tokens.refreshToken).toBeDefined();
    expect(tokens.tokenEndpoint).toBe(`${options.issuer}/oauth/token`);
    expect(await listTools(tokens.accessToken)).toEqual(expect.arrayContaining(['create-task', 'list-tasks']));
  });

  it('refreshes expired tokens with the stored refresh token, from a new store on the same file', async () => {
    const stored = (await getNativeTokens(options))!;
    await options.store!.set(`${options.issuer} ${CLIENT_ID}`, { ...stored, expiresAt: Date.now() - 1000 });

    const reopened = { ...options, store: fileTokenStore(path.join(dir, 'tokens.json')) };
    const refreshed = (await getNativeTokens(reopened))!;

    expect(refreshed.refreshToken).toBeDefined();
    expect(refreshed.refreshToken).not.toBe(stored.refreshToken);
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now() + 3_000_000);
    expect(await listTools(refreshed.accessToken)).toContain('list-tasks');
    expect(await getNativeTokens(reopened)).toEqual(refreshed);
  });
});
