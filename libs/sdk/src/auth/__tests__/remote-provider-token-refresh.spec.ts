/**
 * A remote-mode sign-in keeps the provider's token available to `this.orchestration`:
 *
 * - once the provider's `expires_in` passes (or comes within `refresh.skewSeconds`), FrontMCP renews
 *   it with the provider's refresh token, unless `refresh.enabled` is false;
 * - when the client refreshes FrontMCP's own token, the provider tokens move to the new token, and stay
 *   with the old refresh token until it is rotated.
 *
 * Driven as the client, the browser and the provider reach FrontMCP: DCR, `/oauth/authorize`, the
 * provider's redirect to `/oauth/provider/:id/callback`, then `/oauth/token`.
 */
import 'reflect-metadata';

import { InMemoryAuthorizationStore, InMemoryOrchestratedTokenStore } from '@frontmcp/auth';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  callToolWithToken,
  disposeServers,
  exchangeCode,
  httpGet,
  postForm,
  redirectParams,
  runProviderCallback,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type Scope } from '../../scope/scope.instance';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

@Tool({ name: 'provider_token', inputSchema: {} })
class ProviderTokenTool extends ToolContext {
  async execute() {
    return { token: await this.orchestration.tryGetToken('idp') };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ProviderTokenTool] })
class DeskApp {}

const IDP = 'https://idp.example.com';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const HOST = 'desk.example.com';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

/** The forms the stand-in provider's token endpoint received, and how long its access tokens last. */
let tokenRequests: Record<string, string>[];
let providerExpiresIn: number;
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== IDP) return realFetch(input, init);
    if (url.pathname === '/token') {
      const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
      tokenRequests.push(form);
      return form['grant_type'] === 'refresh_token'
        ? Response.json({ access_token: 'provider-access-2', token_type: 'Bearer', expires_in: 3600 })
        : Response.json({
            access_token: 'provider-access-1',
            refresh_token: 'provider-refresh-1',
            token_type: 'Bearer',
            expires_in: providerExpiresIn,
          });
    }
    if (url.pathname === '/userinfo') return Response.json({ sub: 'auth0|nour', email: 'nour@example.com' });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

beforeEach(() => {
  tokenRequests = [];
  providerExpiresIn = 3600;
});

const servers: TestFetchServer[] = [];

afterAll(async () => {
  globalThis.fetch = realFetch;
  await disposeServers(servers);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function remoteServer(extra: Record<string, unknown> = {}): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'remote-desk', version: '1.0.0' },
    apps: [DeskApp],
    auth: {
      mode: 'remote',
      provider: IDP,
      clientId: 'desk-upstream',
      providerConfig: { id: 'idp' },
      ...extra,
    } as AuthConfig,
  });
  servers.push(server);
  return server;
}

/** Sign in through the provider; returns FrontMCP's tokens and the MCP client's id. */
async function signIn(
  server: TestFetchServer,
): Promise<{ clientId: string; accessToken: string; refreshToken: string }> {
  const registration = await server.handler(
    new Request(`http://${HOST}/oauth/register`, {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none' }),
    }),
  );
  const clientId = String(((await registration.json()) as Record<string, unknown>)['client_id']);
  const authorize = await httpGet(
    server.handler,
    authorizePath({ client_id: clientId, redirect_uri: REDIRECT_URI, scope: 'openid', state: 'client-state' }),
    HOST,
  );
  const providerState = redirectParams(authorize).get('state') ?? '';
  const scope = server.instance.getScopes()[0] as Scope;
  const callback = await runProviderCallback(scope, 'idp', { code: 'idp-code', state: providerState }, HOST);
  const code = redirectParams(callback).get('code') ?? '';
  const tokens = await exchangeCode(server.handler, { code, clientId, redirectUri: REDIRECT_URI }, HOST);
  expect(tokens.status).toBe(200);
  return {
    clientId,
    accessToken: String(tokens.body['access_token']),
    refreshToken: String(tokens.body['refresh_token']),
  };
}

function refreshWith(server: TestFetchServer, refreshToken: string, clientId: string): Promise<Response> {
  return postForm(
    server.handler,
    '/oauth/token',
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
    HOST,
  );
}

async function providerToken(server: TestFetchServer, accessToken: string): Promise<unknown> {
  const call = await callToolWithToken(server.handler, 'provider_token', accessToken, HOST);
  expect(call.status).toBe(200);
  return call.result?.['token'];
}

describe('remote mode keeps the provider token available', () => {
  it('serves the provider token while it is valid, without asking the provider again', async () => {
    const server = await remoteServer();
    const { accessToken } = await signIn(server);

    expect(await providerToken(server, accessToken)).toBe('provider-access-1');
    expect(tokenRequests.map((form) => form['grant_type'])).toEqual(['authorization_code']);
  });

  it("renews a provider token within refresh.skewSeconds of its expiry with the provider's refresh token", async () => {
    providerExpiresIn = 30;
    const server = await remoteServer();
    const { accessToken } = await signIn(server);

    expect(await providerToken(server, accessToken)).toBe('provider-access-2');
    expect(tokenRequests[1]).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'provider-refresh-1',
      client_id: 'desk-upstream',
    });
    expect(await providerToken(server, accessToken)).toBe('provider-access-2');
    expect(tokenRequests).toHaveLength(2);
  });

  it('renews it once its expires_in has passed, and keeps the refresh token the provider did not rotate', async () => {
    const server = await remoteServer({ refresh: { skewSeconds: 0 } });
    const { accessToken } = await signIn(server);
    const signedInAt = Date.now();

    jest.spyOn(Date, 'now').mockReturnValue(signedInAt + 3601_000);
    expect(await providerToken(server, accessToken)).toBe('provider-access-2');

    jest.spyOn(Date, 'now').mockReturnValue(signedInAt + 7202_000);
    expect(await providerToken(server, accessToken)).toBe('provider-access-2');
    expect(tokenRequests.map((form) => form['refresh_token'])).toEqual([
      undefined,
      'provider-refresh-1',
      'provider-refresh-1',
    ]);
  });

  it('does not renew it with refresh.enabled false', async () => {
    providerExpiresIn = 30;
    const server = await remoteServer({ refresh: { enabled: false } });
    const { accessToken } = await signIn(server);
    expect(await providerToken(server, accessToken)).toBe('provider-access-1');

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);

    expect(await providerToken(server, accessToken)).toBeNull();
    expect(tokenRequests).toHaveLength(1);
  });

  it("moves the provider tokens to the new token when the client refreshes FrontMCP's", async () => {
    const server = await remoteServer();
    const { clientId, accessToken, refreshToken } = await signIn(server);

    const refreshed = await postForm(
      server.handler,
      '/oauth/token',
      { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
      HOST,
    );
    const body = (await refreshed.json()) as Record<string, unknown>;
    const secondRefresh = await postForm(
      server.handler,
      '/oauth/token',
      { grant_type: 'refresh_token', refresh_token: String(body['refresh_token']), client_id: clientId },
      HOST,
    );
    const latest = String(((await secondRefresh.json()) as Record<string, unknown>)['access_token']);

    expect(await providerToken(server, latest)).toBe('provider-access-1');
    expect(await providerToken(server, accessToken)).toBeNull();
  });

  it('gives the provider tokens to the next client refresh when copying them fails', async () => {
    const server = await remoteServer();
    const { clientId, refreshToken } = await signIn(server);
    jest
      .spyOn(InMemoryOrchestratedTokenStore.prototype, 'copyTokens')
      .mockRejectedValueOnce(new Error('store unavailable'));

    const failedMove = await postForm(
      server.handler,
      '/oauth/token',
      { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
      HOST,
    );
    const afterFailure = (await failedMove.json()) as Record<string, unknown>;
    const retriedMove = await postForm(
      server.handler,
      '/oauth/token',
      { grant_type: 'refresh_token', refresh_token: String(afterFailure['refresh_token']), client_id: clientId },
      HOST,
    );
    const latest = String(((await retriedMove.json()) as Record<string, unknown>)['access_token']);

    expect(await providerToken(server, latest)).toBe('provider-access-1');
  });

  it('keeps the provider tokens with the refresh token when rotating it fails', async () => {
    const server = await remoteServer();
    const { clientId, refreshToken } = await signIn(server);
    jest
      .spyOn(InMemoryAuthorizationStore.prototype, 'rotateRefreshToken')
      .mockRejectedValueOnce(new Error('store unavailable'));

    const failed = await refreshWith(server, refreshToken, clientId);
    const retried = await refreshWith(server, refreshToken, clientId);
    const latest = String(((await retried.json()) as Record<string, unknown>)['access_token']);

    expect(failed.status).toBe(500);
    expect(await providerToken(server, latest)).toBe('provider-access-1');
  });

  it('gives the provider tokens to every refresh that succeeds when one refresh token is redeemed twice at once', async () => {
    const server = await remoteServer();
    const { clientId, refreshToken } = await signIn(server);

    const responses = await Promise.all([
      refreshWith(server, refreshToken, clientId),
      refreshWith(server, refreshToken, clientId),
    ]);
    const issued = await Promise.all(
      responses.filter((response) => response.status === 200).map((response) => response.json()),
    );

    expect(issued.length).toBeGreaterThan(0);
    for (const body of issued as Record<string, unknown>[]) {
      expect(await providerToken(server, String(body['access_token']))).toBe('provider-access-1');
    }
  });

  it('refuses a redemption that copies the provider tokens after a concurrent one rotated the refresh token', async () => {
    const server = await remoteServer();
    const { clientId, refreshToken } = await signIn(server);
    const auth = (server.instance.getScopes()[0] as Scope).auth as LocalPrimaryAuth;
    const copyTokens = InMemoryOrchestratedTokenStore.prototype.copyTokens;
    let copyStarted = (): void => undefined;
    let releaseCopy = (): void => undefined;
    const started = new Promise<void>((resolve) => (copyStarted = resolve));
    const released = new Promise<void>((resolve) => (releaseCopy = resolve));
    jest.spyOn(InMemoryOrchestratedTokenStore.prototype, 'copyTokens').mockImplementationOnce(async function (
      this: InMemoryOrchestratedTokenStore,
      fromAuthId,
      toAuthId,
    ) {
      copyStarted();
      await released;
      return copyTokens.call(this, fromAuthId, toAuthId);
    });

    const slow = auth.refreshAccessToken(refreshToken, clientId);
    await started;
    const fast = await refreshWith(server, refreshToken, clientId);
    releaseCopy();
    const latest = String(((await fast.json()) as Record<string, unknown>)['access_token']);

    expect(await slow).toMatchObject({ error: 'invalid_grant' });
    expect(await providerToken(server, latest)).toBe('provider-access-1');
  });

  describe('with a token store that cannot copy tokens', () => {
    async function signInWithoutCopy(server: TestFetchServer) {
      const signedIn = await signIn(server);
      const auth = (server.instance.getScopes()[0] as Scope).auth as LocalPrimaryAuth;
      Object.assign(auth.orchestratedTokenStore, { copyTokens: undefined });
      return signedIn;
    }

    it('moves the provider tokens once the refresh token is rotated, so a failed rotation can be retried', async () => {
      const server = await remoteServer();
      const { clientId, refreshToken } = await signInWithoutCopy(server);
      jest
        .spyOn(InMemoryAuthorizationStore.prototype, 'rotateRefreshToken')
        .mockRejectedValueOnce(new Error('store unavailable'));

      const failed = await refreshWith(server, refreshToken, clientId);
      const retried = (await (await refreshWith(server, refreshToken, clientId)).json()) as Record<string, unknown>;
      const retriedToken = await providerToken(server, String(retried['access_token']));
      const next = await refreshWith(server, String(retried['refresh_token']), clientId);
      const latest = String(((await next.json()) as Record<string, unknown>)['access_token']);

      expect(failed.status).toBe(500);
      expect(retriedToken).toBe('provider-access-1');
      expect(await providerToken(server, latest)).toBe('provider-access-1');
    });

    it('keeps the source on the rotated record when the move fails, so the next refresh moves them', async () => {
      const server = await remoteServer();
      const { clientId, refreshToken } = await signInWithoutCopy(server);
      jest
        .spyOn(InMemoryOrchestratedTokenStore.prototype, 'migrateTokens')
        .mockRejectedValueOnce(new Error('store unavailable'));

      const failedMove = await refreshWith(server, refreshToken, clientId);
      const afterFailure = (await failedMove.json()) as Record<string, unknown>;
      const retriedMove = await refreshWith(server, String(afterFailure['refresh_token']), clientId);
      const latest = String(((await retriedMove.json()) as Record<string, unknown>)['access_token']);

      expect(await providerToken(server, latest)).toBe('provider-access-1');
    });
  });
});
