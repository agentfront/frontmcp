/**
 * A refused transparent token carries which check refused it (`failure`), for the server's logs. The `error` a caller
 * may read is unchanged: still the generic `no_provider_verified` for every refusal but a missing `exp`.
 */
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { base64url, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';

import { JwksService } from '../jwks.service';
import type { ProviderVerifyRef } from '../jwks.types';

const ISSUER = 'https://idp.failure.example';
const nowSeconds = () => Math.floor(Date.now() / 1000);

interface ProviderKey {
  jwks: { keys: JWK[] };
  sign(claims?: JWTPayload, header?: { kid?: string }): Promise<string>;
}

async function providerKey(kid: string): Promise<ProviderKey> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return {
    jwks: { keys: [jwk] },
    sign: (claims = {}, header = { kid }) =>
      new SignJWT({ iss: ISSUER, exp: nowSeconds() + 600, ...claims })
        .setProtectedHeader({ alg: 'ES256', ...header })
        .sign(privateKey),
  };
}

const provider = (key: ProviderKey, id = 'idp'): ProviderVerifyRef => ({ id, issuerUrl: ISSUER, jwks: key.jwks });

describe('JwksService.verifyTransparentToken names the check that refused a token', () => {
  let key: ProviderKey;

  beforeAll(async () => {
    key = await providerKey('k1');
  });

  it.each([
    ['expired', () => key.sign({ exp: nowSeconds() - 60 })],
    ['not_yet_valid', () => key.sign({ nbf: nowSeconds() + 600 })],
    ['wrong_issuer', () => key.sign({ iss: 'https://impostor.example' })],
    ['wrong_issuer', () => key.sign({ iss: undefined })],
    ['missing_claim', () => key.sign({ exp: undefined })],
    ['unknown_key', () => key.sign({}, { kid: 'k-unknown' })],
    ['bad_signature', async () => (await providerKey('k1')).sign()],
    ['malformed', async () => 'opaque-token'],
    ['malformed', () => key.sign({ exp: 'tomorrow' as unknown as number })],
  ])('%s', async (failure, makeToken) => {
    const result = await new JwksService().verifyTransparentToken(await makeToken(), [provider(key)]);

    expect(result).toMatchObject({ ok: false, failure });
    expect(result.error).toMatch(/^no_provider_verified|^missing required "exp" claim$/);
  });

  it('unsupported_algorithm: an HS256 token, even with a matching symmetric key', async () => {
    const secret = new Uint8Array(32).fill(7);
    const octJwk = { kty: 'oct', k: base64url.encode(secret), alg: 'HS256', kid: 'sym' } as JWK;
    const token = await new SignJWT({ iss: ISSUER })
      .setProtectedHeader({ alg: 'HS256', kid: 'sym' })
      .setExpirationTime('1h')
      .sign(secret);

    const result = await new JwksService().verifyTransparentToken(token, [
      { id: 'idp', issuerUrl: ISSUER, jwks: { keys: [octJwk] } },
    ]);

    expect(result).toMatchObject({ ok: false, failure: 'unsupported_algorithm' });
  });

  it('jwks_unavailable: the provider has no keys to check it with', async () => {
    const service = new JwksService();
    jest.spyOn(service, 'getJwksForProvider').mockResolvedValue(undefined);

    const result = await service.verifyTransparentToken(await key.sign({}, {}), [
      { id: 'idp', issuerUrl: ISSUER, jwksUri: 'https://idp.failure.example/jwks' },
    ]);

    expect(result).toMatchObject({ ok: false, failure: 'jwks_unavailable' });
  });

  it('names the check of the provider that got furthest, whatever the order of the providers', async () => {
    const other = await providerKey('k2');
    const expired = await key.sign({ exp: nowSeconds() - 60 });

    for (const candidates of [
      [provider(other, 'other'), provider(key)],
      [provider(key), provider(other, 'other')],
    ]) {
      const result = await new JwksService().verifyTransparentToken(expired, candidates);
      expect(result).toMatchObject({ ok: false, failure: 'expired' });
    }
  });

  it('sets no failure on a token it accepts', async () => {
    const result = await new JwksService().verifyTransparentToken(await key.sign(), [provider(key)]);

    expect(result.ok).toBe(true);
    expect(result.failure).toBeUndefined();
  });
});

/** Sign an RS256 JWT via node:crypto, bypassing jose's <2048-bit key-size guard. */
function signRs256(payload: Record<string, unknown>, privateKey: KeyObject, kid = 'weak'): string {
  const encode = (part: unknown) => Buffer.from(JSON.stringify(part)).toString('base64url');
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode(payload)}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

describe('JwksService.verifyTransparentToken names the check on the weak-RSA fallback too', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const forger = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const weakJwk = { ...(publicKey.export({ format: 'jwk' }) as JWK), kid: 'weak', alg: 'RS256' };
  const weakProvider: ProviderVerifyRef = { id: 'weak-idp', issuerUrl: ISSUER, jwks: { keys: [weakJwk] } };

  it.each([
    ['expired', () => signRs256({ iss: ISSUER, exp: nowSeconds() - 60 }, privateKey)],
    ['not_yet_valid', () => signRs256({ iss: ISSUER, exp: nowSeconds() + 600, nbf: nowSeconds() + 600 }, privateKey)],
    ['wrong_issuer', () => signRs256({ iss: 'https://impostor.example', exp: nowSeconds() + 600 }, privateKey)],
    ['wrong_issuer', () => signRs256({ exp: nowSeconds() + 600 }, privateKey)],
    ['missing_claim', () => signRs256({ iss: ISSUER }, privateKey)],
    ['bad_signature', () => signRs256({ iss: ISSUER, exp: nowSeconds() + 600 }, forger.privateKey)],
  ])('%s', async (failure, makeToken) => {
    const result = await new JwksService().verifyTransparentToken(makeToken(), [weakProvider]);

    expect(result).toMatchObject({ ok: false, failure });
  });
});
