/**
 * `/oauth/provider/:providerId/callback` through the fetch handler (Workers,
 * `createFetchHandler`), exactly as a browser reaches it: the provider's
 * redirect back (GET) and the federated consent screen's submission (POST).
 * The route has a path parameter, which the fetch handler's flow matcher must
 * resolve like Express does; otherwise both answer 404 and a federated sign-in
 * (remote mode, local `providers`) can never finish there.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  CookieJar,
  disposeServers,
  exchangeCode,
  httpGet,
  inputValue,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'list_repos', inputSchema: {} })
class ListReposTool extends ToolContext {
  async execute() {
    return { repos: [] };
  }
}

@App({ id: 'code', name: 'Code', tools: [ListReposTool] })
class CodeApp {}

const GITHUB = 'https://github.example.com';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const HOST = 'code.example.com';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== GITHUB) return realFetch(input, init);
    if (url.pathname === '/token') {
      return Response.json({ access_token: 'gh-access-token', token_type: 'Bearer', expires_in: 3600 });
    }
    if (url.pathname === '/userinfo') {
      return Response.json({ sub: 'gh|nour', email: 'nour@example.com', name: 'Nour' });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

const servers: TestFetchServer[] = [];

afterAll(async () => {
  globalThis.fetch = realFetch;
  await disposeServers(servers);
});

async function federatedServer(consent: boolean): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'federated-fetch', version: '1.0.0' },
    apps: [CodeApp],
    auth: {
      mode: 'local',
      dcr: { clients: [{ clientId: 'code-client', redirectUris: [REDIRECT_URI] }] },
      providers: [
        {
          id: 'github',
          authorizeUrl: `${GITHUB}/authorize`,
          tokenUrl: `${GITHUB}/token`,
          userInfoEndpoint: `${GITHUB}/userinfo`,
          clientId: 'gh-client',
        },
      ],
      ...(consent ? { consent: { enabled: true, rememberConsent: false } } : {}),
    } as AuthConfig,
  });
  servers.push(server);
  return server;
}

/** Start a federated sign-in with GitHub; returns the state FrontMCP sent to GitHub. */
async function startFederatedSignIn(server: TestFetchServer, browser: CookieJar): Promise<string> {
  const page = await httpGet(
    server.handler,
    authorizePath({ client_id: 'code-client', redirect_uri: REDIRECT_URI, state: 's' }),
    HOST,
    {},
    browser,
  );
  const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
  const toProvider = await httpGet(
    server.handler,
    `/oauth/callback?${new URLSearchParams({
      pending_auth_id: pendingAuthId,
      federated: 'true',
      providers: 'github',
      email: 'nour@example.com',
    })}`,
    HOST,
    {},
    browser,
  );
  expect(toProvider.status).toBe(302);
  return redirectParams(toProvider).get('state') ?? '';
}

describe('provider callback through the fetch handler', () => {
  it("finishes a sign-in on the provider's redirect", async () => {
    const server = await federatedServer(false);
    const browser = new CookieJar();
    const state = await startFederatedSignIn(server, browser);

    const callback = await httpGet(
      server.handler,
      `/oauth/provider/github/callback?${new URLSearchParams({ code: 'gh-code', state })}`,
      HOST,
      {},
      browser,
    );

    expect(callback.status).toBe(302);
    const code = redirectParams(callback).get('code');
    expect(code).toEqual(expect.any(String));
    const token = await exchangeCode(
      server.handler,
      { code: code ?? '', clientId: 'code-client', redirectUri: REDIRECT_URI },
      HOST,
    );
    expect(token.status).toBe(200);
    expect(token.body['access_token']).toEqual(expect.any(String));
  });

  it('reads a percent-encoded provider id as Express does', async () => {
    const server = await federatedServer(false);
    const browser = new CookieJar();
    const state = await startFederatedSignIn(server, browser);

    const callback = await httpGet(
      server.handler,
      `/oauth/provider/git%68ub/callback?${new URLSearchParams({ code: 'gh-code', state })}`,
      HOST,
      {},
      browser,
    );

    expect(callback.status).toBe(302);
    expect(redirectParams(callback).get('code')).toEqual(expect.any(String));
  });

  it('shows the consent screen, and completes the sign-in when it is submitted', async () => {
    const server = await federatedServer(true);
    const browser = new CookieJar();
    const state = await startFederatedSignIn(server, browser);

    const consent = await httpGet(
      server.handler,
      `/oauth/provider/github/callback?${new URLSearchParams({ code: 'gh-code', state })}`,
      HOST,
      {},
      browser,
    );
    expect(consent.status).toBe(200);
    const html = await consent.text();
    const tool = /name="tools" value="([^"]+)"/.exec(html)?.[1] ?? '';

    const submitted = await postForm(
      server.handler,
      '/oauth/provider/_consent/callback',
      {
        consent_session: inputValue(html, 'consent_session') ?? '',
        consent_submitted: '1',
        tools: tool,
        csrf: inputValue(html, 'csrf') ?? '',
      },
      HOST,
      {},
      browser,
    );

    expect(submitted.status).toBe(302);
    expect(redirectParams(submitted).get('code')).toEqual(expect.any(String));
  });

  it('answers a malformed provider id with 404, as no route matches it', async () => {
    const server = await federatedServer(false);

    const response = await httpGet(server.handler, '/oauth/provider/%E0%A4%A/callback?code=x&state=y', HOST);

    expect(response.status).toBe(404);
  });
});
