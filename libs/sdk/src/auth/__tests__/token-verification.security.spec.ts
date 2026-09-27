/**
 * What a bearer token has to prove before FrontMCP serves it, driven over the
 * fetch handler:
 *
 * - a token FrontMCP issued is bound to the server that issued it (`iss`) and
 *   the resource it was issued for (`aud`), so another server sharing the same
 *   JWT_SECRET refuses it (#269);
 * - an anonymous-grant token is anonymous: `anon:` subject, `isAnonymous`, and
 *   the configured `anonymousScopes` (#270);
 * - a token without `exp` never passes, transparent or FrontMCP-issued (#272).
 */
import 'reflect-metadata';

import { SignJWT } from 'jose';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  callToolWithToken,
  decodeJwtPayload,
  disposeServers,
  exchangeCode,
  httpGet,
  inputValue,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub, isAnonymous: this.auth.isAnonymous, scopes: [...this.auth.scopes] };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const JWT_SECRET = 'k'.repeat(64);
const CLIENT_ID = 'desk-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const DESK = 'desk.example.com';
const BILLING = 'billing.example.com';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const servers: TestFetchServer[] = [];
let previousSecret: string | undefined;

beforeAll(() => {
  previousSecret = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = JWT_SECRET;
});

afterAll(async () => {
  await disposeServers(servers);
  if (previousSecret === undefined) delete process.env['JWT_SECRET'];
  else process.env['JWT_SECRET'] = previousSecret;
});

async function serverWith(name: string, auth: AuthConfig): Promise<TestFetchServer> {
  const server = await createTestFetchServer({ info: { name, version: '1.0.0' }, apps: [DeskApp], auth });
  servers.push(server);
  return server;
}

function localAuth(extra: Record<string, unknown> = {}): AuthConfig {
  return {
    mode: 'local',
    dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
    ...extra,
  } as AuthConfig;
}

/** Sign in on the built-in page at `host` and redeem the code. */
async function signIn(server: TestFetchServer, host: string): Promise<{ access: string; refresh: string }> {
  const page = await httpGet(
    server.handler,
    authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: 's' }),
    host,
  );
  const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
  const callback = await httpGet(
    server.handler,
    `/oauth/callback?${new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'nour@example.com' })}`,
    host,
  );
  const code = redirectParams(callback).get('code') ?? '';
  const tokens = await exchangeCode(server.handler, { code, clientId: CLIENT_ID, redirectUri: REDIRECT_URI }, host);
  expect(tokens.status).toBe(200);
  return { access: String(tokens.body['access_token']), refresh: String(tokens.body['refresh_token']) };
}

function localAuthOf(server: TestFetchServer): LocalPrimaryAuth {
  return server.instance.getScopes()[0].auth as unknown as LocalPrimaryAuth;
}

describe('FrontMCP-issued tokens are bound to the server that issued them (#269)', () => {
  let desk: TestFetchServer;
  let billing: TestFetchServer;

  beforeAll(async () => {
    desk = await serverWith('desk', localAuth());
    billing = await serverWith('billing', localAuth());
  });

  it('serves a token on the server and host it was issued for', async () => {
    const { access } = await signIn(desk, DESK);

    const call = await callToolWithToken(desk.handler, 'whoami', access, DESK);

    expect(call.status).toBe(200);
    expect(call.result?.['isAnonymous']).toBe(false);
  });

  it('refuses a token issued by another server with the same JWT_SECRET', async () => {
    const { access } = await signIn(desk, DESK);

    const call = await callToolWithToken(billing.handler, 'whoami', access, BILLING);

    expect(call.status).toBe(401);
    expect(call.wwwAuthenticate).toContain('invalid_token');
  });

  it('refuses a token whose issuer is another server, even for the same host', async () => {
    const other = await serverWith('other', localAuth({ local: { issuer: 'https://other-issuer.example.com' } }));
    const { access } = await signIn(other, DESK);

    const call = await callToolWithToken(desk.handler, 'whoami', access, DESK);

    expect(call.status).toBe(401);
  });

  it('keeps the audience on refreshed tokens, including grants issued without one', async () => {
    const { refresh } = await signIn(desk, DESK);
    const refreshed = await postForm(
      desk.handler,
      '/oauth/token',
      { grant_type: 'refresh_token', refresh_token: refresh, client_id: CLIENT_ID },
      DESK,
    );
    const access = String(((await refreshed.json()) as Record<string, unknown>)['access_token']);
    expect(decodeJwtPayload(access)['aud']).toBe(`http://${DESK}`);
    expect((await callToolWithToken(desk.handler, 'whoami', access, DESK)).status).toBe(200);

    // A refresh token minted before tokens carried an audience.
    const store = localAuthOf(desk).authorizationStore;
    const legacy = store.createRefreshTokenRecord({ clientId: CLIENT_ID, userSub: 'user-legacy', scopes: ['openid'] });
    await store.storeRefreshToken(legacy);
    const upgraded = await postForm(
      desk.handler,
      '/oauth/token',
      { grant_type: 'refresh_token', refresh_token: legacy.token, client_id: CLIENT_ID },
      DESK,
    );
    const upgradedAccess = String(((await upgraded.json()) as Record<string, unknown>)['access_token']);
    expect(decodeJwtPayload(upgradedAccess)['aud']).toBe(`http://${DESK}`);
    expect((await callToolWithToken(desk.handler, 'whoami', upgradedAccess, DESK)).status).toBe(200);
  });

  it('refuses a token that carries no audience', async () => {
    const token = await new SignJWT({ sub: 'user-1', scope: 'openid' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(localAuthOf(desk).issuer)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(JWT_SECRET));

    expect((await callToolWithToken(desk.handler, 'whoami', token, DESK)).status).toBe(401);
  });
});

describe('anonymous-grant tokens are anonymous (#270)', () => {
  async function anonymousToken(server: TestFetchServer, host: string): Promise<string> {
    const response = await postForm(server.handler, '/oauth/token', { grant_type: 'anonymous', client_id: 'x' }, host);
    expect(response.status).toBe(200);
    return String(((await response.json()) as Record<string, unknown>)['access_token']);
  }

  it('public mode: the holder is anonymous with the default anonymous scopes', async () => {
    const server = await serverWith('public-desk', { mode: 'public' } as AuthConfig);
    const token = await anonymousToken(server, DESK);

    const call = await callToolWithToken(server.handler, 'whoami', token, DESK);

    expect(call.status).toBe(200);
    expect(call.result?.['isAnonymous']).toBe(true);
    expect(String(call.result?.['sub'])).toMatch(/^anon:/);
    expect(call.result?.['scopes']).toEqual(['anonymous']);
    expect(decodeJwtPayload(token)['role']).toBeUndefined();
  });

  it('local mode with allowDefaultPublic: the holder is anonymous with anonymousScopes', async () => {
    const server = await serverWith(
      'local-anon',
      localAuth({ allowDefaultPublic: true, anonymousScopes: ['tickets:read'] }),
    );
    const token = await anonymousToken(server, DESK);

    const call = await callToolWithToken(server.handler, 'whoami', token, DESK);

    expect(call.status).toBe(200);
    expect(call.result?.['isAnonymous']).toBe(true);
    expect(call.result?.['scopes']).toEqual(['tickets:read']);
  });
});

describe('a token without exp never passes (#272)', () => {
  it('transparent mode refuses a provider token that has no exp', async () => {
    const issuer = await createTestJwtIssuer('https://idp.example.com');
    const server = await serverWith('transparent-desk', {
      mode: 'transparent',
      provider: issuer.issuer,
      providerConfig: { jwks: issuer.jwks },
      expectedAudience: `http://${DESK}`,
    } as AuthConfig);
    const withExp = await issuer.sign({ aud: `http://${DESK}` }, 'user-1');
    expect((await callToolWithToken(server.handler, 'whoami', withExp, DESK)).status).toBe(200);

    const withoutExp = await issuer.sign({ aud: `http://${DESK}` }, 'user-1', { exp: false });
    expect((await callToolWithToken(server.handler, 'whoami', withoutExp, DESK)).status).toBe(401);
  });

  it('a FrontMCP-issued token without exp is refused', async () => {
    const desk = await serverWith('desk-exp', localAuth());
    const token = await new SignJWT({ sub: 'user-1', scope: 'openid' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(localAuthOf(desk).issuer)
      .setAudience(`http://${DESK}`)
      .setIssuedAt()
      .sign(new TextEncoder().encode(JWT_SECRET));

    expect((await callToolWithToken(desk.handler, 'whoami', token, DESK)).status).toBe(401);
  });
});
