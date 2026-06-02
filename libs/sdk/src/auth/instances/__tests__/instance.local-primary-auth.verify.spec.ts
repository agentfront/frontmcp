/**
 * LocalPrimaryAuth.verifyGatewayToken — gateway-token signature verification.
 *
 * SECURITY: Gateway tokens (public/local/remote modes) are HS256-signed with
 * the instance's own secret. Before this was wired, the verify path only
 * base64-decoded the payload — a forged or expired JWT with the right shape was
 * accepted. These tests pin the real behavior:
 *   - a token signed with the WRONG secret           → rejected
 *   - an EXPIRED token (signed with the right secret) → rejected
 *   - a token with a tampered signature              → rejected
 *   - a VALID freshly-minted access token            → accepted
 *   - a VALID anonymous token (signAnonymousJwt)     → accepted
 *   - alg confusion (alg:none / RS256)               → rejected
 */
import 'reflect-metadata';

import { SignJWT } from 'jose';

import { LocalPrimaryAuth } from '../instance.local-primary-auth';
import { RemotePrimaryAuth } from '../instance.remote-primary-auth';

/**
 * Minimal ProviderRegistry stub — mirrors the claims spec. The constructor
 * needs getActiveScope() (logger + port) and async initialize() registers
 * flows / credential providers, all stubbed.
 */
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

function createScope() {
  return { fullPath: '' } as never;
}

async function makeAuth() {
  const auth = new LocalPrimaryAuth(createScope(), createProviders(), { mode: 'local' } as never);
  await auth.ready;
  return auth;
}

const BASE_URL = 'http://localhost:3001';

describe('LocalPrimaryAuth.verifyGatewayToken', () => {
  it('accepts a freshly-minted access token signed by the instance', async () => {
    const auth = await makeAuth();
    const token = await auth.signAccessToken({ sub: 'user-123', email: 'u@example.com' }, ['read', 'write']);

    const result = await auth.verifyGatewayToken(token, BASE_URL);

    expect(result.ok).toBe(true);
    expect(result.sub).toBe('user-123');
    expect(result.payload?.['scope']).toBe('read write');
    expect(result.payload?.['email']).toBe('u@example.com');
  });

  it('accepts a valid anonymous token (signAnonymousJwt)', async () => {
    const auth = await makeAuth();
    const token = await auth.signAnonymousJwt();

    const result = await auth.verifyGatewayToken(token, BASE_URL);

    expect(result.ok).toBe(true);
    expect(typeof result.sub).toBe('string');
    expect(result.payload?.['anonymous']).toBe(true);
  });

  it('REJECTS a token signed with the WRONG secret', async () => {
    const auth = await makeAuth();
    // Sign a structurally valid, unexpired token with a secret the instance
    // does not hold. The decode-only path would have accepted this.
    const forged = await new SignJWT({ sub: 'attacker', scope: 'admin' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(BASE_URL)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-totally-different-secret-key-32bytes!'));

    const result = await auth.verifyGatewayToken(forged, BASE_URL);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('REJECTS an expired token even when signed with the right secret', async () => {
    const auth = await makeAuth();
    // Mint a properly-signed token, then craft an expired one with the SAME
    // secret by re-signing with a past exp. We reuse the instance's signer for
    // the valid case, but for expiry we need direct control over exp, so sign
    // a token whose exp is in the past using the instance secret.
    const secret = (auth as unknown as { secret: Uint8Array }).secret;
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ sub: 'user-expired', scope: 'read' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(nowSec - 7200)
      .setIssuer(BASE_URL)
      .setExpirationTime(nowSec - 3600) // expired 1h ago
      .sign(secret);

    const result = await auth.verifyGatewayToken(expired, BASE_URL);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('REJECTS a token with a tampered signature', async () => {
    const auth = await makeAuth();
    const token = await auth.signAccessToken({ sub: 'user-tamper' }, ['read']);
    // Flip the signature segment — header+payload stay intact (still decodable),
    // but the HS256 MAC no longer matches.
    const [h, p] = token.split('.');
    const tampered = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    const result = await auth.verifyGatewayToken(tampered, BASE_URL);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('REJECTS an alg:none token (alg confusion)', async () => {
    const auth = await makeAuth();
    // Unsecured JWT: header alg:none, empty signature segment.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'attacker', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    const unsecured = `${header}.${payload}.`;

    const result = await auth.verifyGatewayToken(unsecured, BASE_URL);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('REJECTS an asymmetric-alg (RS256) header so HS256 is pinned', async () => {
    const auth = await makeAuth();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'attacker', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    const token = `${header}.${payload}.not-a-real-rsa-signature`;

    const result = await auth.verifyGatewayToken(token, BASE_URL);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('REJECTS a non-JWT garbage string', async () => {
    const auth = await makeAuth();
    const result = await auth.verifyGatewayToken('not-a-jwt', BASE_URL);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('falls back to expectedIssuer when the token omits iss', async () => {
    const auth = await makeAuth();
    const secret = (auth as unknown as { secret: Uint8Array }).secret;
    // Sign with the right secret but NO issuer claim.
    const noIss = await new SignJWT({ sub: 'user-no-iss', scope: 'read' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    const result = await auth.verifyGatewayToken(noIss, BASE_URL);

    expect(result.ok).toBe(true);
    // Issuer equality is NOT enforced; expectedIssuer is used for context only.
    expect(result.issuer).toBe(BASE_URL);
  });
});

describe('FrontMcpAuth.verifyGatewayToken — base default (non-gateway instances)', () => {
  it('RemotePrimaryAuth (transparent) rejects gateway verification by default', async () => {
    // Transparent mode verifies against the upstream provider's JWKS, never the
    // gateway path — so the inherited base default must reject, never accept.
    const remote = new RemotePrimaryAuth(createScope(), createProviders(), {
      mode: 'transparent',
      provider: 'https://idp.example.com',
    } as never);
    await remote.ready;

    const result = await remote.verifyGatewayToken('any.jwt.token', BASE_URL);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not supported');
  });
});
