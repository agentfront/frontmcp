/**
 * A sign-in continues only in the browser that started it (RFC 9700 §4.7,
 * RFC 6749 §10.12).
 *
 * The attack: someone starts a sign-in for their own client, then sends a
 * victim who is signed in at the upstream provider to the provider URL they got
 * (it carries their `state`). The provider returns the victim's browser to
 * FrontMCP's provider callback with a code for the victim's provider account,
 * and FrontMCP used to mint the FrontMCP code for the other person's client.
 *
 * Every browser here is a cookie jar: the one that called `/oauth/authorize`
 * holds its sign-in binding cookie, another one doesn't. Driven over the fetch
 * handler (`createFetchHandler` too) and the Node server.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

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
  runProviderCallback,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const IDP = 'https://idp.example.com';
const GITHUB = 'https://github.example.com';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const HOST = 'desk.example.com';
const CLIENT_ID = 'desk-client';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

/** Codes the stand-in providers were asked to redeem. */
const redeemed: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== IDP && url.origin !== GITHUB) return realFetch(input, init);
    if (url.pathname === '/token') {
      redeemed.push(new URLSearchParams(String(init?.body)).get('code') ?? '');
      return Response.json({ access_token: 'provider-access-token', token_type: 'Bearer', expires_in: 3600 });
    }
    if (url.pathname === '/userinfo') {
      return Response.json({ sub: 'provider|victim', email: 'victim@example.com', name: 'Victim' });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

const servers: TestFetchServer[] = [];

afterAll(async () => {
  globalThis.fetch = realFetch;
  await disposeServers(servers);
});

beforeEach(() => {
  redeemed.length = 0;
});

const remoteAuth = {
  mode: 'remote',
  provider: IDP,
  clientId: 'desk-upstream',
  clientSecret: 'upstream-secret',
  providerConfig: { id: 'idp' },
  // The sign-in in these tests starts from a plain client id.
  requireRegisteredClients: false,
} as AuthConfig;

const federatedAuth = {
  mode: 'local',
  dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
  providers: [
    {
      id: 'github',
      authorizeUrl: `${GITHUB}/authorize`,
      tokenUrl: `${GITHUB}/token`,
      userInfoEndpoint: `${GITHUB}/userinfo`,
      clientId: 'gh-client',
    },
  ],
} as AuthConfig;

async function serverWith(name: string, auth: AuthConfig): Promise<{ server: TestFetchServer; scope: Scope }> {
  const server = await createTestFetchServer({ info: { name, version: '1.0.0' }, apps: [DeskApp], auth });
  servers.push(server);
  return { server, scope: server.instance.getScopes()[0] as Scope };
}

function authorizeUrl(state: string): string {
  return authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state });
}

/** Remote mode: start a sign-in in `browser`; returns the `state` FrontMCP sent to the provider. */
async function startRemoteSignIn(server: TestFetchServer, browser: CookieJar, state = 's'): Promise<string> {
  const authorize = await httpGet(server.handler, authorizeUrl(state), HOST, {}, browser);
  expect(authorize.status).toBe(302);
  return redirectParams(authorize).get('state') ?? '';
}

/** Local mode with providers: pick GitHub on the provider-selection page in `browser`; returns the provider `state`. */
async function startFederatedSignIn(server: TestFetchServer, browser: CookieJar): Promise<string> {
  const page = await httpGet(server.handler, authorizeUrl('s'), HOST, {}, browser);
  const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
  const toProvider = await postForm(
    server.handler,
    '/oauth/callback',
    { pending_auth_id: pendingAuthId, federated: 'true', providers: 'github', email: 'someone@example.com' },
    HOST,
    { origin: `http://${HOST}` },
    browser,
  );
  expect(toProvider.status).toBe(302);
  return redirectParams(toProvider).get('state') ?? '';
}

describe('remote mode: the provider callback', () => {
  it('refuses a browser that did not start the sign-in, without redeeming its code', async () => {
    const { server, scope } = await serverWith('desk-remote-attack', remoteAuth);
    const providerState = await startRemoteSignIn(server, new CookieJar());

    const victim = new CookieJar();
    const callback = await runProviderCallback(
      scope,
      'idp',
      { code: 'victim-code', state: providerState },
      HOST,
      undefined,
      victim,
    );

    expect(callback.headers.get('location')).toBeNull();
    expect(callback.status).toBe(400);
    expect(redeemed).toEqual([]);
  });

  it('completes the sign-in in the browser that started it, and removes the cookie', async () => {
    const { server, scope } = await serverWith('desk-remote-legit', remoteAuth);
    const browser = new CookieJar();
    const providerState = await startRemoteSignIn(server, browser);
    expect(browser.header(HOST, '/oauth/provider/idp/callback')).toMatch(/^frontmcp_signin_[0-9a-f]{16}=/);

    const callback = await runProviderCallback(
      scope,
      'idp',
      { code: 'own-code', state: providerState },
      HOST,
      undefined,
      browser,
    );

    expect(callback.status).toBe(302);
    const code = redirectParams(callback).get('code') ?? '';
    const tokens = await exchangeCode(server.handler, { code, clientId: CLIENT_ID, redirectUri: REDIRECT_URI }, HOST);
    expect(tokens.status).toBe(200);
    expect(browser.header(HOST, '/oauth/provider/idp/callback')).toBeUndefined();
  });

  it('keeps several sign-ins of one browser apart', async () => {
    const { server, scope } = await serverWith('desk-remote-concurrent', remoteAuth);
    const browser = new CookieJar();
    const first = await startRemoteSignIn(server, browser, 'first');
    const second = await startRemoteSignIn(server, browser, 'second');

    const secondDone = await runProviderCallback(scope, 'idp', { code: 'c2', state: second }, HOST, undefined, browser);
    const firstDone = await runProviderCallback(scope, 'idp', { code: 'c1', state: first }, HOST, undefined, browser);

    expect(redirectParams(secondDone).get('state')).toBe('second');
    expect(redirectParams(firstDone).get('state')).toBe('first');
  });
});

describe('local mode with upstream providers: the provider callback', () => {
  it('refuses a browser that did not start the sign-in', async () => {
    const { server, scope } = await serverWith('desk-federated-attack', federatedAuth);
    const providerState = await startFederatedSignIn(server, new CookieJar());

    const callback = await runProviderCallback(
      scope,
      'github',
      { code: 'victim-code', state: providerState },
      HOST,
      undefined,
      new CookieJar(),
    );

    expect(callback.headers.get('location')).toBeNull();
    expect(callback.status).toBe(400);
    expect(redeemed).toEqual([]);
  });

  it('completes the sign-in in the browser that started it', async () => {
    const { server, scope } = await serverWith('desk-federated-legit', federatedAuth);
    const browser = new CookieJar();
    const providerState = await startFederatedSignIn(server, browser);

    const callback = await runProviderCallback(
      scope,
      'github',
      { code: 'own-code', state: providerState },
      HOST,
      undefined,
      browser,
    );

    expect(callback.status).toBe(302);
    expect(redirectParams(callback).get('code')).toEqual(expect.any(String));
  });
});

describe('/oauth/callback', () => {
  it('refuses to finish a sign-in in a browser that did not start it', async () => {
    const { server } = await serverWith('desk-local-attack', {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
    } as AuthConfig);
    const page = await httpGet(server.handler, authorizeUrl('s'), HOST, {}, new CookieJar());
    const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';

    // A link: a top-level GET with neither Origin nor Referer.
    const callback = await httpGet(
      server.handler,
      `/oauth/callback?${new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'n@example.com' })}`,
      HOST,
      {},
      new CookieJar(),
    );

    expect(callback.headers.get('location')).toBeNull();
    expect(callback.status).toBe(400);
  });

  it('sets an HttpOnly, SameSite=Lax cookie: scoped to /oauth over http, a __Host- cookie over https', async () => {
    const { server } = await serverWith('desk-local-cookie', {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
    } as AuthConfig);

    const plain = (await httpGet(server.handler, authorizeUrl('s'), HOST, {}, new CookieJar())).headers.getSetCookie();
    const https = (
      await httpGet(server.handler, authorizeUrl('s'), HOST, { 'x-forwarded-proto': 'https' }, new CookieJar())
    ).headers.getSetCookie();

    expect(plain).toHaveLength(1);
    expect(plain[0]).toMatch(
      /^frontmcp_signin_[0-9a-f]{16}=[A-Za-z0-9_-]{43}; Path=\/oauth; Max-Age=1800; HttpOnly; SameSite=Lax$/,
    );
    // `__Host-`: browsers only take it Secure, with Path=/ and no Domain, so no other host can set it.
    expect(https).toHaveLength(1);
    expect(https[0]).toMatch(
      /^__Host-frontmcp_signin_[0-9a-f]{16}=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=1800; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it('over https, refuses a binding cookie a sibling subdomain could plant (no __Host- prefix)', async () => {
    const { server } = await serverWith('desk-local-host-prefix', {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
    } as AuthConfig);
    const https = { 'x-forwarded-proto': 'https', origin: `https://${HOST}` };

    // Someone starts a sign-in and learns its binding cookie.
    const page = await httpGet(server.handler, authorizeUrl('s'), HOST, https, new CookieJar());
    const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
    const [pair] = (page.headers.getSetCookie()[0] ?? '').split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const finish = (cookie: string) =>
      postForm(
        server.handler,
        '/oauth/callback',
        { pending_auth_id: pendingAuthId, email: 'n@example.com' },
        HOST,
        { ...https, cookie },
        new CookieJar(),
      );

    // A host-only cookie of that name, set in the victim's browser from evil.example.com with
    // Domain=example.com, reaches the callback just the same. It must not count.
    const planted = await finish(`${name.replace(/^__Host-/, '')}=${value}`);
    expect(planted.status).toBe(400);
    expect(planted.headers.get('location')).toBeNull();

    // The browser that started the sign-in still finishes it.
    const own = await finish(`${name}=${value}`);
    expect(own.status).toBe(302);
    expect(own.headers.get('location')).toContain(REDIRECT_URI);
  });
});

describe('createFetchHandler', () => {
  it('binds the sign-in to the browser that started it', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'desk-fetch-handler', version: '1.0.0' },
      logging: { level: LogLevel.Off },
      apps: [DeskApp],
      auth: { mode: 'local', dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] } } as AuthConfig,
    });
    const browser = new CookieJar();
    const page = await httpGet(handler, authorizeUrl('s'), HOST, {}, browser);
    const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
    const submit = (jar: CookieJar) =>
      postForm(
        handler,
        '/oauth/callback',
        { pending_auth_id: pendingAuthId, email: 'n@example.com' },
        HOST,
        { origin: `http://${HOST}` },
        jar,
      );

    expect((await submit(new CookieJar())).status).toBe(400);
    const done = await submit(browser);
    expect(done.status).toBe(302);
    expect(redirectParams(done).get('code')).toEqual(expect.any(String));
  });
});

describe('the Node server', () => {
  let node: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = (await FrontMcpInstance.createHandler({
      info: { name: 'desk-node', version: '1.0.0' },
      logging: { level: LogLevel.Off },
      apps: [DeskApp],
      auth: remoteAuth,
    })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => node.close(() => resolve()));
  });

  async function startSignIn(): Promise<{ state: string; cookie: string }> {
    const authorize = await realFetch(`${base}${authorizeUrl('s')}`, { redirect: 'manual' });
    expect(authorize.status).toBe(302);
    const [setCookie] = authorize.headers.getSetCookie();
    return {
      state: new URL(authorize.headers.get('location') ?? '').searchParams.get('state') ?? '',
      cookie: setCookie.split(';')[0],
    };
  }

  it('refuses a provider callback from another browser, and completes it in the one that started it', async () => {
    const attacker = await startSignIn();
    const victim = await realFetch(
      `${base}/oauth/provider/idp/callback?${new URLSearchParams({ code: 'v', state: attacker.state })}`,
      {
        redirect: 'manual',
      },
    );
    expect(victim.status).toBe(400);
    expect(victim.headers.get('location')).toBeNull();

    const own = await startSignIn();
    const done = await realFetch(
      `${base}/oauth/provider/idp/callback?${new URLSearchParams({ code: 'o', state: own.state })}`,
      {
        redirect: 'manual',
        headers: { cookie: own.cookie },
      },
    );
    expect(done.status).toBe(302);
    expect(new URL(done.headers.get('location') ?? '').searchParams.get('code')).toEqual(expect.any(String));
    expect(done.headers.getSetCookie()[0]).toMatch(/^frontmcp_signin_[0-9a-f]{16}=; Path=\/oauth; Max-Age=0;/);
  });
});
