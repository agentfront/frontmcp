import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK } from 'jose';

import { SigningKeyInvalidError } from '../../errors/auth-internal.errors';
import * as joseLoader from '../jose.loader';
import { LocalTokenKeys } from '../local-token-keys';

const SECRET = new TextEncoder().encode('a-jwt-secret-that-is-at-least-32-bytes!');
const ISSUER = 'https://mcp.example.com';

async function privateJwk(alg: 'RS256' | 'ES256' | 'EdDSA', extra: Partial<JWK> = {}): Promise<JWK> {
  const { privateKey } = await generateKeyPair(alg, { extractable: true });
  return { ...(await exportJWK(privateKey)), ...extra };
}

async function publicJwk(alg: 'RS256' | 'ES256', extra: Partial<JWK> = {}): Promise<JWK> {
  const { publicKey } = await generateKeyPair(alg, { extractable: true });
  return { ...(await exportJWK(publicKey)), ...extra };
}

async function sign(keys: LocalTokenKeys, expiresIn = '1h'): Promise<string> {
  return new SignJWT({ sub: 'user-1' })
    .setProtectedHeader(keys.protectedHeader())
    .setIssuer(ISSUER)
    .setExpirationTime(expiresIn)
    .sign(await keys.signingKey());
}

const verifyOptions = { issuer: ISSUER, requiredClaims: ['exp'] };

describe('LocalTokenKeys', () => {
  it('signs HS256 with the secret and publishes nothing when no signKey is set', async () => {
    const keys = LocalTokenKeys.fromConfig({}, SECRET, 'auth.local');
    const token = await sign(keys);

    expect(keys.protectedHeader()).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(keys.publicJwks).toEqual({ keys: [] });
    await expect(jwtVerify(token, SECRET)).resolves.toBeDefined();
    await expect(keys.verify(token, verifyOptions)).resolves.toMatchObject({ payload: { sub: 'user-1' } });
  });

  it('signs HS256 with a Uint8Array signKey in place of the secret', async () => {
    const signKey = new TextEncoder().encode('another-hmac-key-of-at-least-32-bytes');
    const keys = LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local');
    const token = await sign(keys);

    await expect(jwtVerify(token, signKey)).resolves.toBeDefined();
    await expect(jwtVerify(token, SECRET)).rejects.toThrow();
    expect(keys.publicJwks.keys).toHaveLength(0);
  });

  it('signs with an oct JWK, honouring its alg and kid', async () => {
    const k = Buffer.alloc(48, 7).toString('base64url');
    const keys = LocalTokenKeys.fromConfig({ signKey: { kty: 'oct', k, alg: 'HS384', kid: 'h1' } }, SECRET, 'auth');
    const token = await sign(keys);

    expect(keys.protectedHeader()).toEqual({ alg: 'HS384', typ: 'JWT', kid: 'h1' });
    await expect(keys.verify(token, verifyOptions)).resolves.toBeDefined();
    expect(keys.publicJwks.keys).toHaveLength(0);
  });

  it('signs RS256 with an RSA private JWK and publishes only its public half', async () => {
    const signKey = await privateJwk('RS256');
    const keys = LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local');
    const token = await sign(keys);

    const [published] = keys.publicJwks.keys;
    expect(Object.keys(published).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
    expect(published).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', n: signKey.n, e: signKey.e });
    expect(keys.protectedHeader()).toEqual({ alg: 'RS256', typ: 'JWT', kid: published.kid });
    const { createLocalJWKSet } = await import('jose');
    await expect(jwtVerify(token, createLocalJWKSet(keys.publicJwks))).resolves.toBeDefined();
    await expect(keys.verify(token, verifyOptions)).resolves.toMatchObject({ protectedHeader: { alg: 'RS256' } });
  });

  it('builds the JWK set it verifies with once, so each public key is imported once', async () => {
    const keys = LocalTokenKeys.fromConfig({ signKey: await privateJwk('ES256') }, SECRET, 'auth.local');
    const token = await sign(keys);
    const jose = await joseLoader.loadJose();
    const createLocalJWKSet = jest.fn(jose.createLocalJWKSet);
    const loadJose = jest.spyOn(joseLoader, 'loadJose').mockResolvedValue({ ...jose, createLocalJWKSet });

    await expect(keys.verify(token, verifyOptions)).resolves.toBeDefined();
    await expect(keys.verify(token, verifyOptions)).resolves.toBeDefined();

    expect(createLocalJWKSet).toHaveBeenCalledTimes(1);
    loadJose.mockRestore();
  });

  it('names a key without kid by its RFC 7638 thumbprint', async () => {
    const signKey = await privateJwk('ES256');
    const { calculateJwkThumbprint } = await import('jose');
    const keys = LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local');

    expect(keys.kid).toBe(await calculateJwkThumbprint(signKey, 'sha256'));
    expect(keys.alg).toBe('ES256');
  });

  it('keeps a configured kid and signs EdDSA with an Ed25519 key', async () => {
    const keys = LocalTokenKeys.fromConfig({ signKey: await privateJwk('EdDSA', { kid: 'ed-1' }) }, SECRET, 'auth');
    const token = await sign(keys);

    expect(keys.protectedHeader()).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'ed-1' });
    await expect(keys.verify(token, verifyOptions)).resolves.toBeDefined();
  });

  it('publishes the jwks keys beside the signing key and accepts tokens they sign', async () => {
    const retired = await generateKeyPair('ES256', { extractable: true });
    const retiredPublic = { ...(await exportJWK(retired.publicKey)), kid: 'retired' };
    const keys = LocalTokenKeys.fromConfig(
      { signKey: await privateJwk('RS256', { kid: 'current' }), jwks: { keys: [retiredPublic] } },
      SECRET,
      'auth.local',
    );
    const oldToken = await new SignJWT({ sub: 'user-0' })
      .setProtectedHeader({ alg: 'ES256', kid: 'retired' })
      .setIssuer(ISSUER)
      .setExpirationTime('1h')
      .sign(retired.privateKey);

    expect(keys.publicJwks.keys.map((key) => key.kid)).toEqual(['current', 'retired']);
    await expect(keys.verify(oldToken, verifyOptions)).resolves.toMatchObject({ payload: { sub: 'user-0' } });
  });

  it('refuses an HS256 token signed with the secret once an asymmetric key signs', async () => {
    const keys = LocalTokenKeys.fromConfig({ signKey: await privateJwk('RS256') }, SECRET, 'auth.local');
    const hmacToken = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setExpirationTime('1h')
      .sign(SECRET);

    await expect(keys.verify(hmacToken, verifyOptions)).rejects.toThrow();
  });

  it('refuses a token signed by a key it does not publish', async () => {
    const keys = LocalTokenKeys.fromConfig({ signKey: await privateJwk('RS256', { kid: 'a' }) }, SECRET, 'auth.local');
    const other = LocalTokenKeys.fromConfig({ signKey: await privateJwk('RS256', { kid: 'a' }) }, SECRET, 'auth.local');

    await expect(keys.verify(await sign(other), verifyOptions)).rejects.toThrow();
  });

  describe('configuration it refuses', () => {
    it('a public key as signKey', async () => {
      const signKey = await publicJwk('RS256');
      expect(() => LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local')).toThrow(SigningKeyInvalidError);
      expect(() => LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local')).toThrow(
        'auth.local.signKey is a public key',
      );
    });

    it('jwks without an asymmetric signKey', async () => {
      const jwks = { keys: [await publicJwk('RS256')] };
      expect(() => LocalTokenKeys.fromConfig({ jwks }, SECRET, 'auth')).toThrow(
        'auth.jwks is set, but tokens are signed with an HMAC key (JWT_SECRET)',
      );
    });

    it('a private key in jwks', async () => {
      const jwks = { keys: [await privateJwk('ES256')] };
      const signKey = await privateJwk('RS256');
      expect(() => LocalTokenKeys.fromConfig({ signKey, jwks }, SECRET, 'auth')).toThrow(
        'auth.jwks.keys[0] holds a private key',
      );
    });

    it('an oct key in jwks', async () => {
      const jwks = { keys: [{ kty: 'oct', k: 'c2VjcmV0' }] };
      const signKey = await privateJwk('RS256');
      expect(() => LocalTokenKeys.fromConfig({ signKey, jwks }, SECRET, 'auth')).toThrow(
        'auth.jwks.keys[0] has kty "oct"',
      );
    });

    it('an HMAC key shorter than its hash', () => {
      expect(() => LocalTokenKeys.fromConfig({ signKey: new Uint8Array(16) }, SECRET, 'auth.local')).toThrow(
        'auth.local.signKey is 16 bytes; HS256 requires at least 32',
      );
    });

    it('an alg the key type cannot sign with', async () => {
      const signKey = await privateJwk('ES256', { alg: 'RS256' });
      expect(() => LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local')).toThrow(
        'auth.local.signKey has alg "RS256", which EC keys can\'t sign with',
      );
    });

    it('a private key it cannot import, when the key is first needed', async () => {
      const { p: _dropped, ...signKey } = await privateJwk('RS256');
      const keys = LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local');

      await expect(keys.signingKey()).rejects.toThrow(SigningKeyInvalidError);
    });

    it('an EC key whose alg does not match its curve', async () => {
      const signKey = await privateJwk('ES256', { alg: 'ES384' });
      expect(() => LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local')).toThrow(
        'auth.local.signKey has curve "P-256" and alg "ES384"',
      );
    });

    it('a key meant for encryption', async () => {
      const signKey = await privateJwk('RS256', { use: 'enc' });
      expect(() => LocalTokenKeys.fromConfig({ signKey }, SECRET, 'auth.local')).toThrow('has use "enc"');
    });
  });
});
