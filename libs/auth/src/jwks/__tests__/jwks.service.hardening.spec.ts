/**
 * JwksService hardening regression tests:
 *  - transparent verify pins asymmetric algorithms, so a symmetric (`oct`) key
 *    in a provider JWKS can never authenticate an HS-signed token;
 *  - the weak-RSA (<2048-bit) fallback enforces `nbf` (not-yet-valid rejected),
 *    matching the primary jose path which previously it did not.
 */
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { base64url, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { JwksService } from '../jwks.service';

const ISSUER = 'https://idp.hardening.example';

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Sign an RS256 JWT via node:crypto, bypassing jose's <2048-bit key-size guard. */
function signRs256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: KeyObject): string {
  const signingInput = `${b64urlJson({ ...header, alg: 'RS256', typ: 'JWT' })}.${b64urlJson(payload)}`;
  const sig = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
  return `${signingInput}.${sig}`;
}

describe('JwksService — transparent algorithm pinning', () => {
  it('rejects an HS256 token even when the provider JWKS carries a matching symmetric key', async () => {
    const service = new JwksService();
    const secret = new Uint8Array(32).fill(7);
    const octJwk = { kty: 'oct', k: base64url.encode(secret), alg: 'HS256', kid: 'sym', use: 'sig' } as unknown as JWK;
    const hsToken = await new SignJWT({ sub: 'u' })
      .setProtectedHeader({ alg: 'HS256', kid: 'sym' })
      .setIssuer(ISSUER)
      .setExpirationTime('1h')
      .sign(secret);

    const res = await service.verifyTransparentToken(hsToken, [
      { id: 'p', issuerUrl: ISSUER, jwks: { keys: [octJwk] } },
    ]);
    expect(res.ok).toBe(false);
  });

  it('still verifies a normal RS256 token (regression)', async () => {
    const service = new JwksService();
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = (await exportJWK(publicKey)) as JWK;
    jwk.kid = 'rs';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const token = await new SignJWT({ sub: 'u' })
      .setProtectedHeader({ alg: 'RS256', kid: 'rs' })
      .setIssuer(ISSUER)
      .setExpirationTime('1h')
      .sign(privateKey);
    const res = await service.verifyTransparentToken(token, [{ id: 'p', issuerUrl: ISSUER, jwks: { keys: [jwk] } }]);
    expect(res.ok).toBe(true);
  });
});

describe('JwksService — weak-RSA (<2048-bit) fallback hardening', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const weakJwk = {
    ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
    kid: 'weak',
    alg: 'RS256',
    use: 'sig',
  } as unknown as JWK;
  const now = Math.floor(Date.now() / 1000);

  it('accepts a valid weak-key token via the fallback (baseline — exercises the weak path)', async () => {
    const service = new JwksService();
    const token = signRs256({ kid: 'weak' }, { sub: 'u', iss: ISSUER, exp: now + 3600 }, privateKey);
    const res = await service.verifyTransparentToken(token, [
      { id: 'p', issuerUrl: ISSUER, jwks: { keys: [weakJwk] } },
    ]);
    expect(res.ok).toBe(true);
  });

  it('rejects a weak-key token whose nbf is in the future (not-yet-valid)', async () => {
    const service = new JwksService();
    const token = signRs256({ kid: 'weak' }, { sub: 'u', iss: ISSUER, exp: now + 3600, nbf: now + 3600 }, privateKey);
    const res = await service.verifyTransparentToken(token, [
      { id: 'p', issuerUrl: ISSUER, jwks: { keys: [weakJwk] } },
    ]);
    expect(res.ok).toBe(false);
  });
});
