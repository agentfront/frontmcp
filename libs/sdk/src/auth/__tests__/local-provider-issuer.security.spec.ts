/**
 * A local-mode provider (`auth.providers`) is trusted for identity the same way
 * remote mode's provider is (#271): its `id_token` names the user only when it
 * verifies against the provider's keys AND its issuer. Many IdPs sign every
 * tenant's tokens with one key set, so a signature and an `aud` alone don't say
 * which tenant issued the token. A provider with no `issuer` configured
 * therefore gets its identity from `userInfoEndpoint`; one with an `issuer`
 * has its `id_token` and its callback's RFC 9207 `iss` checked against it.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  disposeServers,
  httpGet,
  inputValue,
  redirectParams,
  runProviderCallback,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { type Scope } from '../../scope/scope.instance';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

// `.localhost` keeps the JWKS fetch off DNS; the fetch itself is stubbed below.
const IDP = 'http://corp-idp.localhost';
const TENANT = `${IDP}/tenant-a`;
const CLIENT_ID = 'corp-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const HOST = 'desk.example.com';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

let signingKey: { jwk: JWK; privateKey: CryptoKey };
const realFetch = globalThis.fetch;

async function signIdToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'corp-1' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey.privateKey);
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  signingKey = { jwk: { ...(await exportJWK(publicKey)), kid: 'corp-1', alg: 'RS256', use: 'sig' }, privateKey };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== IDP) return realFetch(input, init);
    if (url.pathname === '/jwks') return Response.json({ keys: [signingKey.jwk] });
    if (url.pathname === '/token') {
      return Response.json({
        access_token: 'corp-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    if (url.pathname === '/userinfo') return Response.json({ sub: 'corp|nour', email: 'nour@example.com' });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

const servers: TestFetchServer[] = [];

afterAll(async () => {
  globalThis.fetch = realFetch;
  await disposeServers(servers);
});

async function localServer(issuer: string | undefined): Promise<{ server: TestFetchServer; scope: Scope }> {
  const server = await createTestFetchServer({
    info: { name: 'local-provider-issuer', version: '1.0.0' },
    apps: [DeskApp],
    auth: {
      mode: 'local',
      dcr: { clients: [{ clientId: 'desk-client', redirectUris: [REDIRECT_URI] }] },
      providers: [
        {
          id: 'corp',
          authorizeUrl: `${IDP}/authorize`,
          tokenUrl: `${IDP}/token`,
          userInfoEndpoint: `${IDP}/userinfo`,
          jwksUri: `${IDP}/jwks`,
          clientId: CLIENT_ID,
          ...(issuer ? { issuer } : {}),
        },
      ],
    } as AuthConfig,
  });
  servers.push(server);
  return { server, scope: server.instance.getScopes()[0] as Scope };
}

/** The identity FrontMCP takes from the `corp` provider for this sign-in (what `CompletedProvider.userInfo` holds). */
async function providerIdentity(issuer: string | undefined, idToken: string): Promise<string> {
  const { scope } = await localServer(issuer);
  const auth = scope.auth as LocalPrimaryAuth;
  return (await auth.getProviderUserInfo('corp', 'corp-access-token', idToken)).sub;
}

/** Start a sign-in through the `corp` provider; returns the scope and the state sent to the provider. */
async function startSignIn(issuer: string | undefined): Promise<{ scope: Scope; state: string }> {
  const { server, scope } = await localServer(issuer);
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
      providers: 'corp',
      email: 'nour@example.com',
    })}`,
    HOST,
  );
  return { scope, state: redirectParams(toProvider).get('state') ?? '' };
}

describe('local-mode provider without an issuer', () => {
  it("does not take the identity from an id_token, whatever tenant's key signed it", async () => {
    const idToken = await signIdToken({ iss: `${IDP}/tenant-b`, aud: CLIENT_ID, sub: 'victim' });

    expect(await providerIdentity(undefined, idToken)).toBe('corp|nour');
  });
});

describe('local-mode provider with an issuer', () => {
  it('takes the identity from an id_token its issuer signed', async () => {
    const idToken = await signIdToken({ iss: TENANT, aud: CLIENT_ID, sub: 'idt|nour' });

    expect(await providerIdentity(TENANT, idToken)).toBe('idt|nour');
  });

  it('does not take the identity from an id_token another issuer signed with the same keys', async () => {
    const idToken = await signIdToken({ iss: `${IDP}/tenant-b`, aud: CLIENT_ID, sub: 'victim' });

    expect(await providerIdentity(TENANT, idToken)).toBe('corp|nour');
  });

  it('refuses a callback whose RFC 9207 iss names another server', async () => {
    const { scope, state } = await startSignIn(TENANT);

    const callback = await runProviderCallback(
      scope,
      'corp',
      { code: 'corp-code', state, iss: 'https://evil.example.com' },
      HOST,
    );

    expect(callback.headers.get('location')).toBeNull();
    expect(callback.status).toBe(400);
  });

  it('accepts a callback whose iss names the provider', async () => {
    const { scope, state } = await startSignIn(TENANT);

    const callback = await runProviderCallback(scope, 'corp', { code: 'corp-code', state, iss: TENANT }, HOST);

    expect(callback.status).toBe(302);
    expect(redirectParams(callback).get('code')).toEqual(expect.any(String));
  });
});
