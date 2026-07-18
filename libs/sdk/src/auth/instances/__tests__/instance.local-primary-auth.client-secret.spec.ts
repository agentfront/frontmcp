/**
 * LocalPrimaryAuth — confidential-client authentication at the token endpoint.
 *
 * Regression: the token endpoint verified only `client_id` equality, so a
 * DCR-minted `client_secret` was never checked — a "confidential" client was
 * effectively public and a stolen refresh token was redeemable with just the
 * public client_id. Confidential clients must now present a matching secret
 * (timing-safe) on both the authorization_code and refresh_token grants.
 */
import 'reflect-metadata';

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
  const auth = new LocalPrimaryAuth({ fullPath: '' } as never, createProviders(), { mode: 'local' } as never);
  await auth.ready;
  return auth;
}

const REDIRECT = 'http://127.0.0.1:9999/cb';
const SCOPES = ['openid'];

function registerConfidentialClient(auth: LocalPrimaryAuth, clientId: string, secret: string) {
  auth.dcrClientRegistry.register({
    client_id: clientId,
    client_secret: secret,
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: [REDIRECT],
    created_at: Math.floor(Date.now() / 1000),
    dev: true,
  });
}

async function mintCode(auth: LocalPrimaryAuth, clientId: string) {
  const verifier = generateCodeVerifier();
  const challenge = sha256Base64url(verifier);
  const code = await auth.createAuthorizationCode({
    clientId,
    redirectUri: REDIRECT,
    scopes: SCOPES,
    codeChallenge: challenge,
    userSub: 'user-1',
  });
  return { code, verifier };
}

describe('LocalPrimaryAuth — confidential client authentication', () => {
  it('rejects code exchange when a confidential client omits its secret', async () => {
    const auth = await makeAuth();
    registerConfidentialClient(auth, 'conf', 'topsecret');
    const { code, verifier } = await mintCode(auth, 'conf');

    const result = await auth.exchangeCode(code, 'conf', REDIRECT, verifier /* no secret */);
    expect('error' in result && result.error).toBe('invalid_client');
  });

  it('rejects code exchange when the secret is wrong', async () => {
    const auth = await makeAuth();
    registerConfidentialClient(auth, 'conf', 'topsecret');
    const { code, verifier } = await mintCode(auth, 'conf');

    const result = await auth.exchangeCode(code, 'conf', REDIRECT, verifier, 'WRONG');
    expect('error' in result && result.error).toBe('invalid_client');
  });

  it('accepts code exchange with the correct secret', async () => {
    const auth = await makeAuth();
    registerConfidentialClient(auth, 'conf', 'topsecret');
    const { code, verifier } = await mintCode(auth, 'conf');

    const result = await auth.exchangeCode(code, 'conf', REDIRECT, verifier, 'topsecret');
    expect('access_token' in result).toBe(true);
  });

  it('rejects refresh when a confidential client presents no / wrong secret', async () => {
    const auth = await makeAuth();
    registerConfidentialClient(auth, 'conf', 'topsecret');
    const { code, verifier } = await mintCode(auth, 'conf');
    const issued = await auth.exchangeCode(code, 'conf', REDIRECT, verifier, 'topsecret');
    if (!('refresh_token' in issued) || !issued.refresh_token) throw new Error('no refresh token');

    const noSecret = await auth.refreshAccessToken(issued.refresh_token, 'conf');
    expect('error' in noSecret && noSecret.error).toBe('invalid_client');

    const wrong = await auth.refreshAccessToken(issued.refresh_token, 'conf', 'WRONG');
    expect('error' in wrong && wrong.error).toBe('invalid_client');
  });

  it('accepts refresh with the correct secret', async () => {
    const auth = await makeAuth();
    registerConfidentialClient(auth, 'conf', 'topsecret');
    const { code, verifier } = await mintCode(auth, 'conf');
    const issued = await auth.exchangeCode(code, 'conf', REDIRECT, verifier, 'topsecret');
    if (!('refresh_token' in issued) || !issued.refresh_token) throw new Error('no refresh token');

    const refreshed = await auth.refreshAccessToken(issued.refresh_token, 'conf', 'topsecret');
    expect('access_token' in refreshed).toBe(true);
  });

  it('leaves public / unregistered clients unaffected (no secret required)', async () => {
    const auth = await makeAuth();
    // 'public-client' is not registered → treated as public, no secret needed.
    const { code, verifier } = await mintCode(auth, 'public-client');
    const result = await auth.exchangeCode(code, 'public-client', REDIRECT, verifier);
    expect('access_token' in result).toBe(true);
  });
});
