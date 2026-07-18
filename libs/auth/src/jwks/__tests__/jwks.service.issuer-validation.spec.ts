/**
 * JwksService — issuer validation security regression tests (GHSA-hvvp-67p3-j379).
 *
 * verifyTransparentToken() must validate the token's `iss` claim strictly
 * against the CONFIGURED provider issuer (plus explicitly allowlisted
 * `additionalIssuers`). The accepted issuer set must never be derived from the
 * unverified token payload — an allowlist that includes the token's own `iss`
 * accepts every issuer, letting any token signed by the provider's keys
 * authenticate regardless of who actually issued it.
 */
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { JwksService } from '../jwks.service';

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

async function createProviderKey(
  kid = 'test-kid',
): Promise<{ privateKey: KeyPair['privateKey']; jwks: { keys: JWK[] } }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  return { privateKey, jwks: { keys: [publicJwk as JWK] } };
}

function signToken(privateKey: KeyPair['privateKey'], issuer: string, kid = 'test-kid'): Promise<string> {
  return new SignJWT({ sub: 'user123' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer)
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('JwksService — transparent issuer validation (GHSA-hvvp-67p3-j379)', () => {
  it('rejects a validly-signed token whose iss differs from the configured issuerUrl', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();

    // Attacker holds a token signed by the provider's key but minted with a
    // different issuer (e.g. another tenant sharing the same key material).
    const jwt = await signToken(privateKey, 'https://attacker.example');

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'victim', issuerUrl: 'https://victim.example', jwks: jwks as never },
    ]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('no_provider_verified');
  });

  it('accepts a token whose iss matches the configured issuerUrl exactly', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    const jwt = await signToken(privateKey, 'https://victim.example');

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'victim', issuerUrl: 'https://victim.example', jwks: jwks as never },
    ]);

    expect(result.ok).toBe(true);
    expect(result.issuer).toBe('https://victim.example');
  });

  it('accepts a token whose iss carries a trailing slash the configured issuerUrl omits', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    // e.g. Auth0-style issuers always end with "/" while configs usually omit it.
    const jwt = await signToken(privateKey, 'https://tenant.idp.example/');

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'idp', issuerUrl: 'https://tenant.idp.example', jwks: jwks as never },
    ]);

    expect(result.ok).toBe(true);
  });

  it('accepts a token without a trailing slash when the configured issuerUrl has one', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    const jwt = await signToken(privateKey, 'https://tenant.idp.example');

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'idp', issuerUrl: 'https://tenant.idp.example/', jwks: jwks as never },
    ]);

    expect(result.ok).toBe(true);
  });

  it('accepts a token whose iss is explicitly allowlisted via additionalIssuers', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    // Gateway deployments can rewrite the issuer; trusting the rewritten value
    // must be an explicit configuration decision, never automatic.
    const jwt = await signToken(privateKey, 'https://gateway.example');

    const result = await service.verifyTransparentToken(jwt, [
      {
        id: 'idp',
        issuerUrl: 'https://idp.example',
        additionalIssuers: ['https://gateway.example'],
        jwks: jwks as never,
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.issuer).toBe('https://gateway.example');
  });

  it('rejects an iss outside issuerUrl + additionalIssuers even with the allowlist configured', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    const jwt = await signToken(privateKey, 'https://attacker.example');

    const result = await service.verifyTransparentToken(jwt, [
      {
        id: 'idp',
        issuerUrl: 'https://idp.example',
        additionalIssuers: ['https://gateway.example'],
        jwks: jwks as never,
      },
    ]);

    expect(result.ok).toBe(false);
  });

  it('accepts a foreign iss when the provider explicitly opts out (verifyIssuer: false)', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    // A trusted gateway re-mints tokens under an unpredictable issuer that the
    // operator cannot enumerate; verifyIssuer:false is the deliberate opt-out.
    const jwt = await signToken(privateKey, 'https://gateway-rewritten-issuer.example');

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'gateway', issuerUrl: 'https://victim.example', verifyIssuer: false, jwks: jwks as never },
    ]);

    expect(result.ok).toBe(true);
    expect(result.issuer).toBe('https://gateway-rewritten-issuer.example');
  });

  it('accepts a token with no iss claim when verifyIssuer is false', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    const jwt = await new SignJWT({ sub: 'user123' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setExpirationTime('1h')
      .sign(privateKey);

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'gateway', issuerUrl: 'https://victim.example', verifyIssuer: false, jwks: jwks as never },
    ]);

    expect(result.ok).toBe(true);
  });

  it('still verifies issuer when verifyIssuer is explicitly true', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    const jwt = await signToken(privateKey, 'https://attacker.example');

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'idp', issuerUrl: 'https://victim.example', verifyIssuer: true, jwks: jwks as never },
    ]);

    expect(result.ok).toBe(false);
  });

  it('rejects a validly-signed token that has no iss claim at all', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    const jwt = await new SignJWT({ sub: 'user123' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setExpirationTime('1h')
      .sign(privateKey);

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'idp', issuerUrl: 'https://idp.example', jwks: jwks as never },
    ]);

    expect(result.ok).toBe(false);
  });

  it('does NOT trust a blank additionalIssuers entry (no iss="" / "/" bypass)', async () => {
    const service = new JwksService();
    const { privateKey, jwks } = await createProviderKey();
    // A token minted with an EMPTY issuer must not be accepted just because a
    // misconfigured additionalIssuers contains a blank string.
    const jwt = await signToken(privateKey, '');

    const result = await service.verifyTransparentToken(jwt, [
      { id: 'idp', issuerUrl: 'https://idp.example', additionalIssuers: ['', '  '] as never, jwks: jwks as never },
    ]);

    expect(result.ok).toBe(false);
  });
});
