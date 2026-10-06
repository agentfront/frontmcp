/**
 * A remote-mode sign-in keeps the provider's token available to `this.orchestration`:
 *
 * - once the provider's `expires_in` passes (or comes within `refresh.skewSeconds`), FrontMCP renews
 *   it with the provider's refresh token, unless `refresh.enabled` is false;
 * - when the client refreshes FrontMCP's own token, the provider tokens move to the new token.
 *
 * Driven as the client, the browser and the provider reach FrontMCP: DCR, `/oauth/authorize`, the
 * provider's redirect to `/oauth/provider/:id/callback`, then `/oauth/token`.
 */
import 'reflect-metadata';

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
});
