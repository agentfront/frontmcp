/**
 * A CIMD client whose document declares `token_endpoint_auth_method: 'private_key_jwt'` is a confidential client
 * authenticated by its key (RFC 7523): driven over the fetch handler, from `/oauth/authorize` to the code exchange
 * and the refresh, each of which needs a valid client assertion.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';

import { CimdService, CLIENT_ASSERTION_TYPE_JWT_BEARER, type ClientMetadataDocument } from '@frontmcp/auth';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  disposeServers,
  httpGet,
  inputValue,
  PKCE_VERIFIER,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const HOST = 'desk.example.com';
const TOKEN_ENDPOINT = `http://${HOST}/oauth/token`;
const CIMD_CLIENT = 'https://client.example.com/oauth/metadata.json';
const REDIRECT = 'http://127.0.0.1:5555/cb';

const servers: TestFetchServer[] = [];
let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'desk-1', alg: 'ES256', use: 'sig' };
});

beforeEach(() => {
  const document: ClientMetadataDocument = {
    client_id: CIMD_CLIENT,
    client_name: 'Desk companion',
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: 'private_key_jwt',
    jwks: { keys: [publicJwk] },
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
  jest.spyOn(CimdService.prototype, 'resolveClientMetadata').mockImplementation(async (clientId) => ({
    isCimdClient: true,
    metadata: { ...document, client_id: clientId },
    fromCache: true,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await disposeServers(servers);
});

async function localServer(): Promise<TestFetchServer> {
  const auth = { mode: 'local' } as NonNullable<FrontMcpConfigInput['auth']>;
  const server = await createTestFetchServer({
    info: { name: 'private-key-jwt', version: '1.0.0' },
    apps: [DeskApp],
    auth,
  });
  servers.push(server);
  return server;
}

function clientAssertion(audience = TOKEN_ENDPOINT, jti = `jti-${Math.random()}`): Promise<string> {
  return new SignJWT({ jti })
    .setProtectedHeader({ alg: 'ES256', kid: 'desk-1' })
    .setIssuer(CIMD_CLIENT)
    .setSubject(CIMD_CLIENT)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(privateKey);
}

async function authorizationCode(server: TestFetchServer): Promise<string> {
  const page = await httpGet(
    server.handler,
    authorizePath({ client_id: CIMD_CLIENT, redirect_uri: REDIRECT, state: 's1' }),
    HOST,
  );
  expect(page.status).toBe(200);
  const pendingAuthId = inputValue(await page.text(), 'pending_auth_id') ?? '';
  const callback = await httpGet(
    server.handler,
    `/oauth/callback?${new URLSearchParams({ pending_auth_id: pendingAuthId, email: 'nour@example.com' })}`,
    HOST,
  );
  expect(callback.status).toBe(302);
  return redirectParams(callback).get('code') ?? '';
}

async function token(server: TestFetchServer, form: Record<string, string>) {
  const response = await postForm(server.handler, '/oauth/token', form, HOST);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function codeExchange(code: string, extra: Record<string, string> = {}): Record<string, string> {
  return { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: PKCE_VERIFIER, ...extra };
}

describe('CIMD clients authenticate with private_key_jwt', () => {
  it('serves the sign-in page to the client and exchanges its code for an assertion naming the token endpoint', async () => {
    const server = await localServer();
    const code = await authorizationCode(server);

    const issued = await token(
      server,
      codeExchange(code, {
        client_id: CIMD_CLIENT,
        client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
        client_assertion: await clientAssertion(),
      }),
    );

    expect(issued.status).toBe(200);
    expect(issued.body['access_token']).toEqual(expect.any(String));
    expect(issued.body['refresh_token']).toEqual(expect.any(String));
  });

  it('takes the client from the assertion when the request leaves client_id out, and accepts the issuer as aud', async () => {
    const server = await localServer();
    const code = await authorizationCode(server);

    const issued = await token(
      server,
      codeExchange(code, {
        client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
        client_assertion: await clientAssertion(`http://${HOST}`),
      }),
    );

    expect(issued.status).toBe(200);
  });

  it('refuses a code exchange without a client assertion, and keeps the code', async () => {
    const server = await localServer();
    const code = await authorizationCode(server);

    const refused = await token(server, codeExchange(code, { client_id: CIMD_CLIENT }));
    const retried = await token(
      server,
      codeExchange(code, {
        client_id: CIMD_CLIENT,
        client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
        client_assertion: await clientAssertion(),
      }),
    );

    expect(refused).toEqual({
      status: 400,
      body: { error: 'invalid_client', error_description: 'Client authentication failed' },
    });
    expect(retried.status).toBe(200);
  });

  it('refuses an assertion signed for another client than the request names', async () => {
    const server = await localServer();
    const code = await authorizationCode(server);

    const refused = await token(
      server,
      codeExchange(code, {
        client_id: 'https://other.example.com/oauth/metadata.json',
        client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
        client_assertion: await clientAssertion(),
      }),
    );

    expect(refused.body['error']).toBe('invalid_client');
  });

  it('needs a fresh assertion for every refresh, and refuses a replayed one', async () => {
    const server = await localServer();
    const code = await authorizationCode(server);
    const assertion = await clientAssertion();
    const issued = await token(
      server,
      codeExchange(code, {
        client_id: CIMD_CLIENT,
        client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
        client_assertion: assertion,
      }),
    );
    const refreshToken = String(issued.body['refresh_token']);
    const refresh = (extra: Record<string, string>) =>
      token(server, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CIMD_CLIENT, ...extra });

    const withoutAssertion = await refresh({});
    const replayed = await refresh({
      client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
      client_assertion: assertion,
    });
    const fresh = await refresh({
      client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
      client_assertion: await clientAssertion(),
    });

    expect(withoutAssertion.body['error']).toBe('invalid_client');
    expect(replayed.body['error']).toBe('invalid_client');
    expect(fresh.status).toBe(200);
    expect(fresh.body['access_token']).toEqual(expect.any(String));
  });

  it('advertises private_key_jwt and its signing algorithms in the authorization server metadata', async () => {
    const server = await localServer();

    const metadata = (await (
      await httpGet(server.handler, '/.well-known/oauth-authorization-server', HOST)
    ).json()) as Record<string, unknown>;

    expect(metadata['token_endpoint_auth_methods_supported']).toEqual([
      'none',
      'client_secret_basic',
      'client_secret_post',
      'private_key_jwt',
    ]);
    expect(metadata['token_endpoint_auth_signing_alg_values_supported']).toEqual(
      expect.arrayContaining(['RS256', 'PS256', 'ES256', 'EdDSA']),
    );
    expect(metadata['token_endpoint_auth_signing_alg_values_supported']).not.toContain('HS256');
  });
});
