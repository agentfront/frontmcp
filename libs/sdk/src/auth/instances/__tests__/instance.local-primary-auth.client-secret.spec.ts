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

import type { RefreshTokenRecord } from '@frontmcp/auth';
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
const SCOPES = ['openid'];

function registerPublicClient(auth: LocalPrimaryAuth, clientId: string) {
  auth.dcrClientRegistry.register({
    client_id: clientId,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: [REDIRECT],
    created_at: Math.floor(Date.now() / 1000),
    dev: true,
  });
}

/** Issue a refresh token on `issuer`, and store its record on `restarted`, which has no registration for the client. */
async function issueAndMoveRefreshToken(
  issuer: LocalPrimaryAuth,
  restarted: LocalPrimaryAuth,
  clientId: string,
  secret?: string,
): Promise<RefreshTokenRecord> {
  const { code, verifier } = await mintCode(issuer, clientId);
  const issued = await issuer.exchangeCode(code, clientId, REDIRECT, verifier, secret);
  if (!('refresh_token' in issued) || !issued.refresh_token) throw new Error('no refresh token');
  const record = await issuer.authorizationStore.getRefreshToken(issued.refresh_token);
  if (!record) throw new Error('refresh token not stored');
  await restarted.authorizationStore.storeRefreshToken(record);
  return record;
}

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
    clientAuthMethod: auth.dcrClientRegistry.get(clientId)?.token_endpoint_auth_method ?? 'none',
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

  it('records how the client authenticates in the refresh token record', async () => {
    const auth = await makeAuth();
    registerConfidentialClient(auth, 'conf', 'topsecret');
    const record = await issueAndMoveRefreshToken(auth, auth, 'conf', 'topsecret');
    expect(record.clientAuthMethod).toBe('client_secret_post');

    const refreshed = await auth.refreshAccessToken(record.token, 'conf', 'topsecret');
    if (!('refresh_token' in refreshed) || !refreshed.refresh_token) throw new Error('no rotated refresh token');
    const rotated = await auth.authorizationStore.getRefreshToken(refreshed.refresh_token);
    expect(rotated?.clientAuthMethod).toBe('client_secret_post');
  });

  it("refuses a confidential client's refresh token where its registration is not known, with or without a secret", async () => {
    const issuer = await makeAuth();
    const restarted = await makeAuth();
    registerConfidentialClient(issuer, 'conf', 'topsecret');
    const record = await issueAndMoveRefreshToken(issuer, restarted, 'conf', 'topsecret');

    const noSecret = await restarted.refreshAccessToken(record.token, 'conf');
    expect('error' in noSecret && noSecret.error).toBe('invalid_client');
    const withSecret = await restarted.refreshAccessToken(record.token, 'conf', 'topsecret');
    expect('error' in withSecret && withSecret.error).toBe('invalid_client');
  });

  it("refreshes a public client's refresh token where its registration is not known", async () => {
    const issuer = await makeAuth();
    const restarted = await makeAuth();
    registerPublicClient(issuer, 'pub');
    const record = await issueAndMoveRefreshToken(issuer, restarted, 'pub');
    expect(record.clientAuthMethod).toBe('none');

    const refreshed = await restarted.refreshAccessToken(record.token, 'pub');
    expect('access_token' in refreshed).toBe(true);
  });

  it('refuses a refresh token stored without an auth method when the client is not registered', async () => {
    const issuer = await makeAuth();
    const restarted = await makeAuth();
    registerPublicClient(issuer, 'pub');
    const { clientAuthMethod: _recorded, ...storedBefore } = await issueAndMoveRefreshToken(issuer, issuer, 'pub');
    await restarted.authorizationStore.storeRefreshToken(storedBefore);

    const refreshed = await restarted.refreshAccessToken(storedBefore.token, 'pub');
    expect('error' in refreshed && refreshed.error).toBe('invalid_client');
  });

  it('refreshes a refresh token stored without an auth method when the client is registered, and records it', async () => {
    const auth = await makeAuth();
    registerConfidentialClient(auth, 'conf', 'topsecret');
    const { clientAuthMethod: _recorded, ...storedBefore } = await issueAndMoveRefreshToken(
      auth,
      auth,
      'conf',
      'topsecret',
    );
    await auth.authorizationStore.storeRefreshToken(storedBefore);

    const refreshed = await auth.refreshAccessToken(storedBefore.token, 'conf', 'topsecret');
    if (!('refresh_token' in refreshed) || !refreshed.refresh_token) throw new Error('no rotated refresh token');
    const rotated = await auth.authorizationStore.getRefreshToken(refreshed.refresh_token);
    expect(rotated?.clientAuthMethod).toBe('client_secret_post');
  });

  it("refuses a confidential client's code exchanged where its registration is not known", async () => {
    const issuer = await makeAuth();
    const otherInstance = await makeAuth();
    registerConfidentialClient(issuer, 'conf', 'topsecret');
    const { code, verifier } = await mintCode(issuer, 'conf');
    const codeRecord = await issuer.authorizationStore.getAuthorizationCode(code);
    if (!codeRecord) throw new Error('code not stored');
    expect(codeRecord.clientAuthMethod).toBe('client_secret_post');
    await otherInstance.authorizationStore.storeAuthorizationCode(codeRecord);

    const result = await otherInstance.exchangeCode(code, 'conf', REDIRECT, verifier, 'topsecret');
    expect('error' in result && result.error).toBe('invalid_client');
  });

  it.each([
    ['the confidential method recorded when the authorization started', 'client_secret_post'],
    ['no recorded method', undefined],
  ])('refuses a code minted, with %s, on an instance without the registration', async (_case, clientAuthMethod) => {
    const callbackInstance = await makeAuth();
    const verifier = generateCodeVerifier();
    const code = await callbackInstance.createAuthorizationCode({
      clientId: 'conf',
      clientAuthMethod,
      redirectUri: REDIRECT,
      scopes: SCOPES,
      codeChallenge: sha256Base64url(verifier),
      userSub: 'user-1',
    });

    const result = await callbackInstance.exchangeCode(code, 'conf', REDIRECT, verifier, 'topsecret');
    expect('error' in result && result.error).toBe('invalid_client');
  });

  it("exchanges a public client's code where its registration is not known, and labels its refresh token public", async () => {
    const issuer = await makeAuth();
    const otherInstance = await makeAuth();
    registerPublicClient(issuer, 'pub');
    const { code, verifier } = await mintCode(issuer, 'pub');
    const codeRecord = await issuer.authorizationStore.getAuthorizationCode(code);
    if (!codeRecord) throw new Error('code not stored');
    await otherInstance.authorizationStore.storeAuthorizationCode(codeRecord);

    const result = await otherInstance.exchangeCode(code, 'pub', REDIRECT, verifier);
    if (!('refresh_token' in result) || !result.refresh_token) throw new Error('no refresh token');
    const refreshRecord = await otherInstance.authorizationStore.getRefreshToken(result.refresh_token);
    expect(refreshRecord?.clientAuthMethod).toBe('none');
  });

  it('keeps requiring client authentication for a confidential grant once the client is registered as public', async () => {
    const issuer = await makeAuth();
    const changed = await makeAuth();
    registerConfidentialClient(issuer, 'conf', 'topsecret');
    registerPublicClient(changed, 'conf');
    const refreshRecord = await issueAndMoveRefreshToken(issuer, changed, 'conf', 'topsecret');
    const { code, verifier } = await mintCode(issuer, 'conf');
    const codeRecord = await issuer.authorizationStore.getAuthorizationCode(code);
    if (!codeRecord) throw new Error('code not stored');
    await changed.authorizationStore.storeAuthorizationCode(codeRecord);

    const refreshed = await changed.refreshAccessToken(refreshRecord.token, 'conf');
    expect('error' in refreshed && refreshed.error).toBe('invalid_client');
    const exchanged = await changed.exchangeCode(code, 'conf', REDIRECT, verifier);
    expect('error' in exchanged && exchanged.error).toBe('invalid_client');
  });

  it('leaves public / unregistered clients unaffected (no secret required)', async () => {
    const auth = await makeAuth();
    // 'public-client' is not registered → treated as public, no secret needed.
    const { code, verifier } = await mintCode(auth, 'public-client');
    const result = await auth.exchangeCode(code, 'public-client', REDIRECT, verifier);
    expect('access_token' in result).toBe(true);
    if (!('refresh_token' in result) || !result.refresh_token) throw new Error('no refresh token');

    const refreshed = await auth.refreshAccessToken(result.refresh_token, 'public-client');
    expect('access_token' in refreshed).toBe(true);
  });
});
