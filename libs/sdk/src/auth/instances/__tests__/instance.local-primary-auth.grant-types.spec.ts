/**
 * LocalPrimaryAuth — the token endpoint honors the grant types a client declared (RFC 7591 `grant_types`), from
 * its registration, its `dcr.clients` entry or its client ID metadata document.
 */
import 'reflect-metadata';

import { CimdService, type ClientMetadataDocument, type RegisteredClient } from '@frontmcp/auth';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

import { LocalPrimaryAuth } from '../instance.local-primary-auth';

function createProviders() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  return {
    getActiveScope: () => ({
      logger,
      metadata: { http: { port: 3001 } },
      registryFlows: jest.fn().mockResolvedValue(undefined),
    }),
    injectProvider: jest.fn(),
    addDynamicProviders: jest.fn().mockResolvedValue(undefined),
  } as never;
}

async function makeAuth() {
  const auth = new LocalPrimaryAuth({ fullPath: '', onDispose: jest.fn() } as never, createProviders(), {
    mode: 'local',
  } as never);
  await auth.ready;
  return auth;
}

const REDIRECT = 'http://127.0.0.1:9999/cb';
const CIMD_CLIENT = 'https://client.example.com/oauth/client.json';

function registerClient(auth: LocalPrimaryAuth, clientId: string, grantTypes: string[]) {
  const client: RegisteredClient = {
    client_id: clientId,
    token_endpoint_auth_method: 'none',
    grant_types: grantTypes,
    response_types: ['code'],
    redirect_uris: [REDIRECT],
    created_at: Math.floor(Date.now() / 1000),
    dev: true,
  };
  auth.dcrClientRegistry.register(client);
}

async function redeemCode(auth: LocalPrimaryAuth, clientId: string) {
  const verifier = generateCodeVerifier();
  const code = await auth.createAuthorizationCode({
    clientId,
    redirectUri: REDIRECT,
    scopes: ['openid'],
    codeChallenge: sha256Base64url(verifier),
    userSub: 'user-1',
  });
  return auth.exchangeCode(code, clientId, REDIRECT, verifier);
}

function cimdDocument(overrides: Partial<ClientMetadataDocument> = {}): ClientMetadataDocument {
  return {
    client_id: CIMD_CLIENT,
    client_name: 'Desk',
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    ...overrides,
  };
}

function serveCimdDocument(document: ClientMetadataDocument) {
  return jest
    .spyOn(CimdService.prototype, 'resolveClientMetadata')
    .mockResolvedValue({ isCimdClient: true, metadata: document, fromCache: true });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('LocalPrimaryAuth — declared grant types at the token endpoint', () => {
  it('issues no refresh token to a registered client without the refresh_token grant', async () => {
    const auth = await makeAuth();
    registerClient(auth, 'code-only', ['authorization_code']);

    const result = await redeemCode(auth, 'code-only');

    expect('access_token' in result).toBe(true);
    expect('refresh_token' in result && result.refresh_token).toBeFalsy();
  });

  it('refuses the refresh_token grant to a registered client that did not declare it', async () => {
    const auth = await makeAuth();
    registerClient(auth, 'narrowed', ['authorization_code', 'refresh_token']);
    const issued = await redeemCode(auth, 'narrowed');
    if (!('refresh_token' in issued) || !issued.refresh_token) throw new Error('no refresh token');
    registerClient(auth, 'narrowed', ['authorization_code']);

    const result = await auth.refreshAccessToken(issued.refresh_token, 'narrowed');

    expect('error' in result && result.error).toBe('unauthorized_client');
  });

  it('refuses the authorization_code grant to a registered client that did not declare it', async () => {
    const auth = await makeAuth();
    registerClient(auth, 'refresh-only', ['refresh_token']);

    const result = await redeemCode(auth, 'refresh-only');

    expect('error' in result && result.error).toBe('unauthorized_client');
  });

  it('issues and honors a refresh token for a registered client that declared both grants', async () => {
    const auth = await makeAuth();
    registerClient(auth, 'full', ['authorization_code', 'refresh_token']);
    const issued = await redeemCode(auth, 'full');
    if (!('refresh_token' in issued) || !issued.refresh_token) throw new Error('no refresh token');

    const refreshed = await auth.refreshAccessToken(issued.refresh_token, 'full');

    expect('access_token' in refreshed).toBe(true);
  });

  it('issues no refresh token to a CIMD client whose document leaves out refresh_token', async () => {
    const auth = await makeAuth();
    serveCimdDocument(cimdDocument());

    const result = await redeemCode(auth, CIMD_CLIENT);

    expect('access_token' in result).toBe(true);
    expect('refresh_token' in result && result.refresh_token).toBeFalsy();
  });

  it('issues a refresh token to a CIMD client whose document declares refresh_token', async () => {
    const auth = await makeAuth();
    serveCimdDocument(cimdDocument({ grant_types: ['authorization_code', 'refresh_token'] }));

    const result = await redeemCode(auth, CIMD_CLIENT);

    expect('refresh_token' in result && result.refresh_token).toBeTruthy();
  });

  it('refuses a CIMD client whose document declares private_key_jwt', async () => {
    const auth = await makeAuth();
    serveCimdDocument(
      cimdDocument({
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [{ kty: 'RSA', n: 'x', e: 'AQAB' }] },
      }),
    );

    const result = await redeemCode(auth, CIMD_CLIENT);

    expect('error' in result && result.error).toBe('invalid_client');
  });
});
