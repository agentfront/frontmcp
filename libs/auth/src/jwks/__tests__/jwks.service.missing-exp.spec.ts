/**
 * A transparent token without `exp` is refused (#272) with a reason that says
 * so. The reason is given only for a token a configured provider signed; any
 * other refusal keeps the generic `no_provider_verified`, so the message tells
 * a caller nothing about a token it forged.
 */
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { JwksService } from '../jwks.service';

const ISSUER = 'https://idp.example.com';

async function providerKey(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  const sign = (options: { exp: boolean }) => {
    const jwt = new SignJWT({ sub: 'nour' }).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(ISSUER);
    return (options.exp ? jwt.setExpirationTime('10m') : jwt).sign(privateKey);
  };
  return { jwks: { keys: [jwk] }, sign };
}

describe('JwksService.verifyTransparentToken — missing exp', () => {
  it('names the missing exp for a token the provider signed', async () => {
    const key = await providerKey('k1');
    const service = new JwksService();

    const result = await service.verifyTransparentToken(await key.sign({ exp: false }), [
      { id: 'idp', issuerUrl: ISSUER, jwks: key.jwks },
    ]);

    expect(result).toEqual({ ok: false, error: 'missing required "exp" claim' });
  });

  it('names it when a second provider is configured too', async () => {
    const key = await providerKey('k1');
    const other = await providerKey('k2');
    const service = new JwksService();

    const result = await service.verifyTransparentToken(await key.sign({ exp: false }), [
      { id: 'other', issuerUrl: 'https://other.example.com', jwks: other.jwks },
      { id: 'idp', issuerUrl: ISSUER, jwks: key.jwks },
    ]);

    expect(result.error).toBe('missing required "exp" claim');
  });

  it('keeps the generic reason for a token no configured provider signed', async () => {
    const key = await providerKey('k1');
    const forger = await providerKey('k1');
    const service = new JwksService();

    const result = await service.verifyTransparentToken(await forger.sign({ exp: false }), [
      { id: 'idp', issuerUrl: ISSUER, jwks: key.jwks },
    ]);

    expect(result).toEqual({ ok: false, error: 'no_provider_verified (kid=k1)' });
  });

  it('still verifies a token with exp', async () => {
    const key = await providerKey('k1');
    const service = new JwksService();

    const result = await service.verifyTransparentToken(await key.sign({ exp: true }), [
      { id: 'idp', issuerUrl: ISSUER, jwks: key.jwks },
    ]);

    expect(result.ok).toBe(true);
  });
});
