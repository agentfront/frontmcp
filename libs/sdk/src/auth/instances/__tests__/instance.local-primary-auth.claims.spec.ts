/**
 * LocalPrimaryAuth — custom-claims threading (Checkpoint 3a).
 *
 * Verifies that custom claims from a local `authenticate` verifier are embedded
 * in the minted access token (via signAccessToken), survive the
 * createAuthorizationCode → exchangeCode round-trip, and that reserved claims
 * (sub/iss/exp/scope/…) can never be clobbered by a verifier.
 */
import 'reflect-metadata';

import { generatePkceChallenge } from '@frontmcp/auth';
import { base64urlDecode, generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

import { LocalPrimaryAuth } from '../instance.local-primary-auth';

// Decode a JWT payload (no signature verification — introspection only).
function decodeJwt(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  return JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64))) as Record<string, unknown>;
}

/**
 * Minimal ProviderRegistry stub. The constructor calls getActiveScope() for the
 * logger + port and async initialize() registers flows; we stub those so no real
 * scope/flow wiring is needed.
 */
function createProviders() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
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
    // Checkpoint 3b — initialize() registers the credential-vault providers.
    addDynamicProviders: jest.fn().mockResolvedValue(undefined),
  } as never;
}

function createScope() {
  return { fullPath: '' } as never;
}

async function makeAuth() {
  const auth = new LocalPrimaryAuth(createScope(), createProviders(), { mode: 'local' } as never);
  await auth.ready;
  return auth;
}

const FIXED_SCOPES = ['read', 'write'];

describe('LocalPrimaryAuth.signAccessToken — custom claims (Checkpoint 3a)', () => {
  it('embeds custom claims in the minted token', async () => {
    const auth = await makeAuth();
    const token = await auth.signAccessToken({ sub: 'user-1' }, FIXED_SCOPES, undefined, {
      customClaims: { tenantId: 'acme', plan: 'pro' },
    });
    const payload = decodeJwt(token);
    expect(payload['tenantId']).toBe('acme');
    expect(payload['plan']).toBe('pro');
    // Reserved claims still intact.
    expect(payload['sub']).toBe('user-1');
    expect(payload['scope']).toBe('read write');
  });

  it('drops reserved claims so a verifier cannot forge identity/lifetime/scope', async () => {
    const auth = await makeAuth();
    const token = await auth.signAccessToken({ sub: 'real-sub' }, FIXED_SCOPES, undefined, {
      customClaims: {
        sub: 'forged-sub',
        iss: 'evil',
        exp: 1,
        scope: 'admin',
        tenantId: 'ok-claim',
      },
    });
    const payload = decodeJwt(token);
    // Reserved claims untouched by the verifier.
    expect(payload['sub']).toBe('real-sub');
    expect(payload['scope']).toBe('read write');
    expect(payload['iss']).not.toBe('evil');
    expect(payload['exp']).not.toBe(1);
    // Non-reserved claim is kept.
    expect(payload['tenantId']).toBe('ok-claim');
  });

  it('mints a normal token when no custom claims are supplied (default unchanged)', async () => {
    const auth = await makeAuth();
    const token = await auth.signAccessToken({ sub: 'user-2' }, FIXED_SCOPES);
    const payload = decodeJwt(token);
    expect(payload['sub']).toBe('user-2');
    expect(payload['scope']).toBe('read write');
    expect(Object.keys(payload)).not.toContain('tenantId');
  });

  it('threads customClaims through createAuthorizationCode → exchangeCode into the token', async () => {
    const auth = await makeAuth();
    const verifier = generateCodeVerifier();
    const challenge = sha256Base64url(verifier);
    const redirectUri = 'http://127.0.0.1:9999/cb';
    const clientId = 'client-xyz';

    const code = await auth.createAuthorizationCode({
      clientId,
      redirectUri,
      scopes: FIXED_SCOPES,
      codeChallenge: challenge,
      userSub: 'sub-roundtrip',
      customClaims: { org: 'acme-corp', role: 'editor' },
    });

    const result = await auth.exchangeCode(code, clientId, redirectUri, verifier);
    expect('access_token' in result).toBe(true);
    if (!('access_token' in result)) return;
    const payload = decodeJwt(result.access_token);
    expect(payload['org']).toBe('acme-corp');
    expect(payload['role']).toBe('editor');
    expect(payload['sub']).toBe('sub-roundtrip');
  });

  it('verifies the pkce-bound code mints no custom claims when none were stored', async () => {
    const auth = await makeAuth();
    const verifier = generateCodeVerifier();
    const challenge = sha256Base64url(verifier);
    const redirectUri = 'http://127.0.0.1:9999/cb';
    const clientId = 'client-abc';
    // Sanity that generatePkceChallenge agrees with our challenge derivation.
    expect(generatePkceChallenge(verifier).challenge).toBe(challenge);

    const code = await auth.createAuthorizationCode({
      clientId,
      redirectUri,
      scopes: FIXED_SCOPES,
      codeChallenge: challenge,
      userSub: 'sub-plain',
    });
    const result = await auth.exchangeCode(code, clientId, redirectUri, verifier);
    if (!('access_token' in result)) throw new Error('expected token');
    const payload = decodeJwt(result.access_token);
    expect(payload['sub']).toBe('sub-plain');
    expect(payload['org']).toBeUndefined();
  });
});
