/**
 * JwksService finds a provider's keys through OpenID Connect Discovery.
 *
 * OpenID providers publish their key set's address as `jwks_uri` in
 * `<issuer>/.well-known/openid-configuration` (OpenID Connect Discovery 1.0 §4);
 * many (Google, Entra) serve no OAuth authorization server metadata and no key
 * set at `<issuer>/.well-known/jwks.json`. Without discovery, their tokens and
 * `id_token`s could be verified only with an explicit `jwksUri`.
 */
import * as dns from 'node:dns';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { JwksService } from '../jwks.service';

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const ISSUER = 'https://accounts.idp.example.com';
const KEYS_URL = 'https://keys.idp.example.com/oauth2/v3/certs';

describe('JwksService — OpenID discovery', () => {
  let jwk: JWK;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let mockFetch: jest.SpyInstance;
  let documents: Record<string, unknown>;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  });

  beforeEach(() => {
    (dns.promises.lookup as unknown as jest.Mock).mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    documents = {
      [`${ISSUER}/.well-known/openid-configuration`]: { issuer: ISSUER, jwks_uri: KEYS_URL },
      [KEYS_URL]: { keys: [jwk] },
    };
    mockFetch = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = documents[url];
      return body ? Response.json(body) : new Response('not found', { status: 404 });
    });
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  const requestedUrls = () => mockFetch.mock.calls.map(([url]) => String(url));

  it('finds the key set named by jwks_uri in the OpenID configuration', async () => {
    const service = new JwksService();

    const jwks = await service.getJwksForProvider({ id: 'idp', issuerUrl: ISSUER });

    expect(jwks?.keys).toEqual([jwk]);
    expect(requestedUrls()).toContain(`${ISSUER}/.well-known/openid-configuration`);
  });

  it('verifies a token signed with a key found that way', async () => {
    const service = new JwksService();
    const token = await new SignJWT({ sub: 'nour' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setExpirationTime('10m')
      .sign(privateKey);

    const result = await service.verifyTransparentToken(token, [{ id: 'idp', issuerUrl: ISSUER }]);

    expect(result).toMatchObject({ ok: true, sub: 'nour' });
  });

  it('still prefers OAuth authorization server metadata when the provider serves it', async () => {
    documents[`${ISSUER}/.well-known/oauth-authorization-server`] = { issuer: ISSUER, jwks_uri: KEYS_URL };
    const service = new JwksService();

    await service.getJwksForProvider({ id: 'idp', issuerUrl: ISSUER });

    expect(requestedUrls()).not.toContain(`${ISSUER}/.well-known/openid-configuration`);
  });

  it('fetches the key set at <issuer>/.well-known/jwks.json, before any discovery document (#766)', async () => {
    documents = { [`${ISSUER}/.well-known/jwks.json`]: { keys: [jwk] } };
    const service = new JwksService();

    const jwks = await service.getJwksForProvider({ id: 'idp', issuerUrl: ISSUER });

    expect(jwks?.keys).toEqual([jwk]);
    expect(requestedUrls()).toEqual([`${ISSUER}/.well-known/jwks.json`]);
  });

  it('finds nothing when neither discovery document names a key set', async () => {
    delete documents[`${ISSUER}/.well-known/openid-configuration`];
    const service = new JwksService();

    expect(await service.getJwksForProvider({ id: 'idp', issuerUrl: ISSUER })).toBeUndefined();
  });

  it('never fetches a jwks_uri that points at an internal address', async () => {
    documents[`${ISSUER}/.well-known/openid-configuration`] = {
      issuer: ISSUER,
      jwks_uri: 'https://169.254.169.254/keys',
    };
    const service = new JwksService();

    expect(await service.getJwksForProvider({ id: 'idp', issuerUrl: ISSUER })).toBeUndefined();
    expect(requestedUrls()).not.toContain('https://169.254.169.254/keys');
  });
});
