/**
 * LocalPrimaryAuth — authorization-code replay revokes the issued token family.
 *
 * Regression: a reused (already-consumed) authorization code used to only
 * delete the code record, leaving the refresh/access tokens minted from it
 * live. Per OAuth 2.1 §4.1.2, a detected code replay must revoke the tokens
 * issued from that code. The code now records its issued refresh token and the
 * replay path revokes it.
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

describe('LocalPrimaryAuth — authorization-code replay revocation', () => {
  it('revokes the issued refresh token when a used code is replayed', async () => {
    const auth = await makeAuth();
    const clientId = 'client-replay';
    const verifier = generateCodeVerifier();
    const challenge = sha256Base64url(verifier);

    const code = await auth.createAuthorizationCode({
      clientId,
      redirectUri: REDIRECT,
      scopes: ['openid'],
      codeChallenge: challenge,
      userSub: 'user-1',
    });

    // First exchange succeeds and yields a refresh token.
    const first = await auth.exchangeCode(code, clientId, REDIRECT, verifier);
    if (!('refresh_token' in first) || !first.refresh_token) throw new Error('no refresh token');
    const refreshToken = first.refresh_token;

    // The refresh token works before the replay.
    const okRefresh = await auth.refreshAccessToken(refreshToken, clientId);
    expect('access_token' in okRefresh).toBe(true);

    // Mint a fresh grant to get a NON-rotated issued token to prove revocation,
    // since the first refresh above rotated `refreshToken`. Re-run the flow.
    const verifier2 = generateCodeVerifier();
    const code2 = await auth.createAuthorizationCode({
      clientId,
      redirectUri: REDIRECT,
      scopes: ['openid'],
      codeChallenge: sha256Base64url(verifier2),
      userSub: 'user-1',
    });
    const grant2 = await auth.exchangeCode(code2, clientId, REDIRECT, verifier2);
    if (!('refresh_token' in grant2) || !grant2.refresh_token) throw new Error('no refresh token 2');
    const issuedToken2 = grant2.refresh_token;

    // Replaying code2 (already used) must be rejected AND revoke issuedToken2.
    const replay = await auth.exchangeCode(code2, clientId, REDIRECT, verifier2);
    expect('error' in replay && replay.error).toBe('invalid_grant');

    const afterReplay = await auth.refreshAccessToken(issuedToken2, clientId);
    expect('error' in afterReplay && afterReplay.error).toBe('invalid_grant');
  });
});
