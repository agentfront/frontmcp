/**
 * The upstream provider's answer is what signs a user in (remote mode, and the
 * providers of local mode). Driven as the browser and the provider reach
 * FrontMCP: `/oauth/authorize` over the fetch handler, then the provider's
 * redirect to `/oauth/provider/:id/callback`.
 *
 * - A declined or failed sign-in at the provider never yields a code (#259).
 * - The provider's identity is checked: its `id_token` is used only when it
 *   verifies (signature, issuer, audience, expiry), and an RFC 9207 `iss` on
 *   the callback must name the provider (#271).
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  decodeJwtPayload,
  disposeServers,
  exchangeCode,
  httpGet,
  inputValue,
  redirectParams,
  runProviderCallback,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
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
const UPSTREAM_CLIENT_ID = 'desk-upstream';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const HOST = 'desk.example.com';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

interface IdpKey {
  jwk: JWK;
  sign(claims: Record<string, unknown>): Promise<string>;
}

async function idpKey(kid: string): Promise<IdpKey> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return {
    jwk,
    sign: (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey),
  };
}

/** What the stand-in provider answers at its token endpoint. */
let idTokenForNextExchange: string | undefined;
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== IDP && url.origin !== 'https://github.example.com') return realFetch(input, init);
    if (url.pathname === '/token') {
      return Response.json({
        access_token: 'idp-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        ...(idTokenForNextExchange ? { id_token: idTokenForNextExchange } : {}),
      });
    }
    if (url.pathname === '/userinfo') {
      return Response.json({ sub: 'auth0|nour', email: 'nour@example.com', name: 'Nour' });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

const servers: TestFetchServer[] = [];

afterAll(async () => {
  globalThis.fetch = realFetch;
  await disposeServers(servers);
});

afterEach(() => {
  idTokenForNextExchange = undefined;
});

async function remoteServer(providerJwks: { keys: JWK[] }): Promise<{ server: TestFetchServer; scope: Scope }> {
  const server = await createTestFetchServer({
    info: { name: 'remote-desk', version: '1.0.0' },
    apps: [DeskApp],
    auth: {
      mode: 'remote',
      provider: IDP,
      clientId: UPSTREAM_CLIENT_ID,
      clientSecret: 'upstream-secret',
      providerConfig: { id: 'idp', jwks: providerJwks },
    } as AuthConfig,
  });
  servers.push(server);
  return { server, scope: server.instance.getScopes()[0] as Scope };
}

/** Register an MCP client (DCR) and start its sign-in; returns the state FrontMCP sent to the provider. */
async function startSignIn(server: TestFetchServer): Promise<{ clientId: string; providerState: string }> {
  const registration = await server.handler(
    new Request(`http://${HOST}/oauth/register`, {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none' }),
    }),
  );
  expect(registration.status).toBe(201);
  const clientId = String(((await registration.json()) as Record<string, unknown>)['client_id']);

  const authorize = await httpGet(
    server.handler,
    authorizePath({ client_id: clientId, redirect_uri: REDIRECT_URI, scope: 'openid', state: 'client-state' }),
    HOST,
  );
  expect(authorize.status).toBe(302);
  const providerState = redirectParams(authorize).get('state') ?? '';
  expect(providerState).toMatch(/^federated:/);
  return { clientId, providerState };
}

/** Finish a sign-in whose provider callback redirected back to the client; returns the minted `sub`. */
async function subjectFromCallback(server: TestFetchServer, clientId: string, callback: Response): Promise<unknown> {
  expect(callback.status).toBe(302);
  const code = redirectParams(callback).get('code') ?? '';
  const tokens = await exchangeCode(server.handler, { code, clientId, redirectUri: REDIRECT_URI }, HOST);
  expect(tokens.status).toBe(200);
  return decodeJwtPayload(String(tokens.body['access_token']))['sub'];
}

describe('a declined or failed sign-in at the provider never yields a code (#259)', () => {
  it('remote mode: error=access_denied on the provider callback is refused', async () => {
    const key = await idpKey('idp-1');
    const { server, scope } = await remoteServer({ keys: [key.jwk] });
    const { providerState } = await startSignIn(server);

    const callback = await runProviderCallback(scope, 'idp', { error: 'access_denied', state: providerState }, HOST);

    expect(callback.headers.get('location')).toBeNull();
    expect(callback.status).toBe(400);
  });

  it('local mode: declining a required provider does not mint a code', async () => {
    const server = await createTestFetchServer({
      info: { name: 'local-providers', version: '1.0.0' },
      apps: [DeskApp],
      auth: {
        mode: 'local',
        dcr: { clients: [{ clientId: 'desk-client', redirectUris: [REDIRECT_URI] }] },
        providers: [
          {
            id: 'github',
            authorizeUrl: 'https://github.example.com/authorize',
            tokenUrl: 'https://github.example.com/token',
            clientId: 'gh-client',
          },
        ],
        federatedAuth: { requiredProviders: ['github'] },
      } as AuthConfig,
    });
    servers.push(server);
    const scope = server.instance.getScopes()[0] as Scope;

    const page = await httpGet(
      server.handler,
      authorizePath({ client_id: 'desk-client', redirect_uri: REDIRECT_URI, state: 's' }),
      HOST,
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
    );
    const providerState = redirectParams(toProvider).get('state') ?? '';

    const callback = await runProviderCallback(scope, 'github', { error: 'access_denied', state: providerState }, HOST);

    expect(callback.headers.get('location')).toBeNull();
    expect(callback.status).toBe(400);
  });
});

describe("the provider's identity is checked (#271)", () => {
  it('refuses a callback whose RFC 9207 iss names another server', async () => {
    const key = await idpKey('idp-1');
    const { server, scope } = await remoteServer({ keys: [key.jwk] });
    const { providerState } = await startSignIn(server);

    const callback = await runProviderCallback(
      scope,
      'idp',
      { code: 'idp-code', state: providerState, iss: 'https://evil.example.com' },
      HOST,
    );

    expect(callback.headers.get('location')).toBeNull();
    expect(callback.status).toBe(400);
  });

  it('accepts a callback whose iss names the provider', async () => {
    const key = await idpKey('idp-1');
    const { server, scope } = await remoteServer({ keys: [key.jwk] });
    const { clientId, providerState } = await startSignIn(server);

    const callback = await runProviderCallback(
      scope,
      'idp',
      { code: 'idp-code', state: providerState, iss: `${IDP}/` },
      HOST,
    );

    expect(await subjectFromCallback(server, clientId, callback)).toBe('auth0|nour');
  });

  it('does not take the identity from an id_token signed by a key the provider does not publish', async () => {
    const key = await idpKey('idp-1');
    const forger = await idpKey('idp-1');
    const { server, scope } = await remoteServer({ keys: [key.jwk] });
    const { clientId, providerState } = await startSignIn(server);
    idTokenForNextExchange = await forger.sign({ iss: IDP, aud: UPSTREAM_CLIENT_ID, sub: 'victim' });

    const callback = await runProviderCallback(scope, 'idp', { code: 'idp-code', state: providerState }, HOST);

    expect(await subjectFromCallback(server, clientId, callback)).toBe('auth0|nour');
  });

  it.each([
    ['another audience', { iss: IDP, aud: 'someone-else', sub: 'victim' }],
    ['another issuer', { iss: 'https://other-idp.example.com', aud: UPSTREAM_CLIENT_ID, sub: 'victim' }],
  ])('does not take the identity from an id_token issued for %s', async (_label, claims) => {
    const key = await idpKey('idp-1');
    const { server, scope } = await remoteServer({ keys: [key.jwk] });
    const { clientId, providerState } = await startSignIn(server);
    idTokenForNextExchange = await key.sign(claims);

    const callback = await runProviderCallback(scope, 'idp', { code: 'idp-code', state: providerState }, HOST);

    expect(await subjectFromCallback(server, clientId, callback)).toBe('auth0|nour');
  });

  it('takes the identity from an id_token that verifies', async () => {
    const key = await idpKey('idp-1');
    const { server, scope } = await remoteServer({ keys: [key.jwk] });
    const { clientId, providerState } = await startSignIn(server);
    idTokenForNextExchange = await key.sign({ iss: IDP, aud: UPSTREAM_CLIENT_ID, sub: 'idt|nour' });

    const callback = await runProviderCallback(scope, 'idp', { code: 'idp-code', state: providerState }, HOST);

    expect(await subjectFromCallback(server, clientId, callback)).toBe('idt|nour');
  });
});
