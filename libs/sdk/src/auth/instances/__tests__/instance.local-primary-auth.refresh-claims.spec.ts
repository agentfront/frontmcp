/**
 * LocalPrimaryAuth — refresh preserves consent / progressive-auth claims.
 *
 * Regression for the consent/incremental-authorization bypass: refreshing an
 * access token used to re-mint WITHOUT the grant's `consent` / `authorized_apps`
 * / custom claims (the refresh record didn't even persist them), and the tool
 * gate treats a missing claim as "allow all" — so one public `/oauth/token`
 * refresh escalated past user consent and per-app authorization. The refresh
 * record now carries the metadata and re-embeds it on every refresh.
 */
import 'reflect-metadata';

import { base64urlDecode, generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

import { LocalPrimaryAuth } from '../instance.local-primary-auth';

function decodeJwt(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  return JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64))) as Record<string, unknown>;
}

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
  const auth = new LocalPrimaryAuth({ fullPath: '' } as never, createProviders(), { mode: 'local' } as never);
  await auth.ready;
  return auth;
}

const SCOPES = ['openid', 'profile'];

async function mintAndExchange(
  auth: LocalPrimaryAuth,
  clientId: string,
  extra: Record<string, unknown>,
): Promise<{ access_token: string; refresh_token?: string }> {
  const verifier = generateCodeVerifier();
  const challenge = sha256Base64url(verifier);
  const redirectUri = 'http://127.0.0.1:9999/cb';
  const code = await auth.createAuthorizationCode({
    clientId,
    redirectUri,
    scopes: SCOPES,
    codeChallenge: challenge,
    userSub: 'user-consent',
    userEmail: 'u@example.com',
    userName: 'Consented User',
    ...extra,
  } as never);
  const result = await auth.exchangeCode(code, clientId, redirectUri, verifier);
  if (!('access_token' in result)) throw new Error('exchange failed');
  return result as { access_token: string; refresh_token?: string };
}

describe('LocalPrimaryAuth.refreshAccessToken — preserves consent/authorized_apps claims', () => {
  it('keeps the consent claim across a refresh', async () => {
    const auth = await makeAuth();
    const clientId = 'client-consent';
    const issued = await mintAndExchange(auth, clientId, {
      consentEnabled: true,
      selectedToolIds: ['notes:list'],
    });

    // The originally issued token carries the consent claim.
    const initial = decodeJwt(issued.access_token);
    expect(initial['consent']).toEqual({ enabled: true, selectedTools: ['notes:list'] });
    expect(issued.refresh_token).toBeTruthy();

    // After refreshing, the new access token STILL carries the same consent claim.
    const refreshed = await auth.refreshAccessToken(issued.refresh_token as string, clientId);
    expect('access_token' in refreshed).toBe(true);
    if (!('access_token' in refreshed)) return;
    const payload = decodeJwt(refreshed.access_token);
    expect(payload['consent']).toEqual({ enabled: true, selectedTools: ['notes:list'] });
    expect(payload['sub']).toBe('user-consent');
  });

  it('keeps the authorized_apps claim across a refresh', async () => {
    const auth = await makeAuth();
    const clientId = 'client-apps';
    const issued = await mintAndExchange(auth, clientId, {
      authorizedAppIds: ['crm'],
    });
    expect(decodeJwt(issued.access_token)['authorized_apps']).toEqual(['crm']);

    const refreshed = await auth.refreshAccessToken(issued.refresh_token as string, clientId);
    if (!('access_token' in refreshed)) throw new Error('refresh failed');
    expect(decodeJwt(refreshed.access_token)['authorized_apps']).toEqual(['crm']);
  });

  it('keeps claims across a SECOND (rotated) refresh', async () => {
    const auth = await makeAuth();
    const clientId = 'client-rotate';
    const issued = await mintAndExchange(auth, clientId, {
      consentEnabled: true,
      selectedToolIds: ['a:x'],
      authorizedAppIds: ['a'],
    });

    const r1 = await auth.refreshAccessToken(issued.refresh_token as string, clientId);
    if (!('access_token' in r1)) throw new Error('refresh 1 failed');
    const r2 = await auth.refreshAccessToken(r1.refresh_token as string, clientId);
    if (!('access_token' in r2)) throw new Error('refresh 2 failed');

    const payload = decodeJwt(r2.access_token);
    expect(payload['consent']).toEqual({ enabled: true, selectedTools: ['a:x'] });
    expect(payload['authorized_apps']).toEqual(['a']);
  });
});
