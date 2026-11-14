/**
 * LocalPrimaryAuth — a grant redeemed by two token requests at once.
 *
 * The store lets one request claim a code or a refresh token; the other one must get `invalid_grant`
 * (RFC 6749 §5.2), not an exception that the token endpoint answers with 500.
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
  const activeScope = {
    logger,
    metadata: { http: { port: 3001 } },
    registryFlows: jest.fn().mockResolvedValue(undefined),
  };
  return {
    getActiveScope: () => activeScope,
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

const CLIENT_ID = 'client-concurrent';
const REDIRECT_URI = 'http://127.0.0.1:9999/cb';

async function createCode(auth: LocalPrimaryAuth): Promise<{ code: string; verifier: string }> {
  const verifier = generateCodeVerifier();
  const code = await auth.createAuthorizationCode({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: ['openid'],
    codeChallenge: sha256Base64url(verifier),
    userSub: 'user-concurrent',
  } as never);
  return { code, verifier };
}

describe('LocalPrimaryAuth — a grant redeemed by two requests at once', () => {
  it('gives the second refresh with one refresh token invalid_grant', async () => {
    const auth = await makeAuth();
    const { code, verifier } = await createCode(auth);
    const issued = await auth.exchangeCode(code, CLIENT_ID, REDIRECT_URI, verifier);
    if (!('refresh_token' in issued) || !issued.refresh_token) throw new Error('no refresh token was issued');

    const results = await Promise.all([
      auth.refreshAccessToken(issued.refresh_token, CLIENT_ID),
      auth.refreshAccessToken(issued.refresh_token, CLIENT_ID),
    ]);

    expect(results.filter((result) => 'access_token' in result)).toHaveLength(1);
    expect(results.filter((result) => 'error' in result)).toEqual([
      { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired' },
    ]);
  });

  it('gives an exchange whose code another request claimed first invalid_grant', async () => {
    const auth = await makeAuth();
    const { code, verifier } = await createCode(auth);
    const store = (auth as unknown as { authorizationStore: { markCodeUsed(code: string): Promise<void> } })
      .authorizationStore;
    const markCodeUsed = store.markCodeUsed.bind(store);
    jest.spyOn(store, 'markCodeUsed').mockImplementationOnce(async (claimed: string) => {
      await markCodeUsed(claimed);
      await markCodeUsed(claimed);
    });

    const result = await auth.exchangeCode(code, CLIENT_ID, REDIRECT_URI, verifier);

    expect(result).toEqual({ error: 'invalid_grant', error_description: 'Authorization code has already been used' });
  });
});
