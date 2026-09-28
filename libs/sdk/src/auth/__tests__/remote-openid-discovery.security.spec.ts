/**
 * Remote mode verifies the provider's `id_token` with the keys the provider
 * publishes. OpenID providers (Google, Okta, Auth0, Entra) publish their key
 * set's address in `/.well-known/openid-configuration` (`jwks_uri`), not at
 * `<provider>/.well-known/jwks.json` nor in OAuth metadata, so that document is
 * part of the lookup: without it, a valid `id_token` from such a provider was
 * never used and the identity always came from the userinfo endpoint.
 *
 * The stand-in provider below publishes its keys only through OpenID discovery.
 */
import 'reflect-metadata';

import * as dns from 'node:dns';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  decodeJwtPayload,
  disposeServers,
  exchangeCode,
  httpGet,
  redirectParams,
  runProviderCallback,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type Scope } from '../../scope/scope.instance';

// The provider's hosts resolve to a public address (the JWKS fetch checks where a host points).
jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const IDP = 'https://accounts.idp.example.com';
const KEYS_URL = 'https://keys.idp.example.com/oauth2/v3/certs';
const UPSTREAM_CLIENT_ID = 'desk-upstream';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const HOST = 'desk.example.com';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

let signingKey: { jwk: JWK; sign(claims: Record<string, unknown>): Promise<string> };
let idTokenForNextExchange: string | undefined;
const requested: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  (dns.promises.lookup as unknown as jest.Mock).mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'google-like', alg: 'RS256', use: 'sig' };
  signingKey = {
    jwk,
    sign: (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'google-like' })
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey),
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!url.hostname.endsWith('idp.example.com')) return realFetch(input, init);
    requested.push(url.href);
    if (url.href === `${IDP}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: IDP,
        authorization_endpoint: `${IDP}/authorize`,
        token_endpoint: `${IDP}/token`,
        userinfo_endpoint: `${IDP}/userinfo`,
        jwks_uri: KEYS_URL,
      });
    }
    if (url.href === KEYS_URL) return Response.json({ keys: [signingKey.jwk] });
    if (url.href === `${IDP}/token`) {
      return Response.json({
        access_token: 'idp-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        ...(idTokenForNextExchange ? { id_token: idTokenForNextExchange } : {}),
      });
    }
    if (url.href === `${IDP}/userinfo`) return Response.json({ sub: 'userinfo|nour', email: 'nour@example.com' });
    // Neither `<provider>/.well-known/jwks.json` nor OAuth authorization server metadata exists.
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

const servers: TestFetchServer[] = [];

afterAll(async () => {
  globalThis.fetch = realFetch;
  await disposeServers(servers);
});

async function remoteServer(): Promise<{ server: TestFetchServer; scope: Scope }> {
  const server = await createTestFetchServer({
    info: { name: 'remote-desk', version: '1.0.0' },
    apps: [DeskApp],
    auth: {
      mode: 'remote',
      provider: IDP,
      clientId: UPSTREAM_CLIENT_ID,
      clientSecret: 'upstream-secret',
      providerConfig: { id: 'idp' },
    } as AuthConfig,
  });
  servers.push(server);
  return { server, scope: server.instance.getScopes()[0] as Scope };
}

/** Sign in through the stand-in provider; returns the `sub` of the token FrontMCP mints. */
async function signInSubject(server: TestFetchServer, scope: Scope): Promise<unknown> {
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

  const callback = await runProviderCallback(scope, 'idp', { code: 'idp-code', state: providerState }, HOST);
  expect(callback.status).toBe(302);
  const code = redirectParams(callback).get('code') ?? '';
  const tokens = await exchangeCode(server.handler, { code, clientId, redirectUri: REDIRECT_URI }, HOST);
  expect(tokens.status).toBe(200);
  return decodeJwtPayload(String(tokens.body['access_token']))['sub'];
}

describe("remote mode finds the provider's keys through OpenID discovery", () => {
  afterEach(() => {
    idTokenForNextExchange = undefined;
    requested.length = 0;
  });

  it('takes the identity from an id_token signed by a key published at the discovered jwks_uri', async () => {
    const { server, scope } = await remoteServer();
    idTokenForNextExchange = await signingKey.sign({ iss: IDP, aud: UPSTREAM_CLIENT_ID, sub: 'idt|nour' });

    expect(await signInSubject(server, scope)).toBe('idt|nour');
    expect(requested).toContain(`${IDP}/.well-known/openid-configuration`);
    expect(requested).toContain(KEYS_URL);
  });

  it('still refuses an id_token issued for another client, and falls back to userinfo', async () => {
    const { server, scope } = await remoteServer();
    idTokenForNextExchange = await signingKey.sign({ iss: IDP, aud: 'someone-else', sub: 'victim' });

    expect(await signInSubject(server, scope)).toBe('userinfo|nour');
  });
});
