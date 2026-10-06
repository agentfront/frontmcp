/**
 * A token signed with a key the cached key set doesn't have (the provider rotated to a new `kid`)
 * makes JwksService fetch the keys again before refusing it, instead of waiting out the 6-hour
 * cache. At most one such refetch per provider a minute, so tokens with made-up `kid`s can't
 * hammer the provider.
 */
import * as dns from 'node:dns';

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';

import { JwksService } from '../jwks.service';

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const ISSUER = 'https://idp.example.com';
const KEYS_URL = 'https://idp.example.com/keys';
const PROVIDER = { id: 'idp', issuerUrl: ISSUER, jwksUri: KEYS_URL };

describe('JwksService — unknown kid', () => {
  let currentKey: JWK;
  let nextKey: JWK;
  let nextPrivateKey: CryptoKey;
  let currentPrivateKey: CryptoKey;
  let publishedKeys: JWK[];
  let mockFetch: jest.SpyInstance;

  beforeAll(async () => {
    const current = await generateKeyPair('ES256');
    const next = await generateKeyPair('ES256');
    currentPrivateKey = current.privateKey;
    nextPrivateKey = next.privateKey;
    currentKey = { ...(await exportJWK(current.publicKey)), kid: 'desk-2', alg: 'ES256', use: 'sig' };
    nextKey = { ...(await exportJWK(next.publicKey)), kid: 'desk-3', alg: 'ES256', use: 'sig' };
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    (dns.promises.lookup as unknown as jest.Mock).mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    publishedKeys = [currentKey];
    mockFetch = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input) =>
        String(input) === KEYS_URL
          ? Response.json({ keys: publishedKeys })
          : new Response('not found', { status: 404 }),
      );
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.useRealTimers();
  });

  function sign(privateKey: CryptoKey, kid: string): Promise<string> {
    return new SignJWT({ sub: 'nour' })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(ISSUER)
      .setExpirationTime('10m')
      .sign(privateKey);
  }

  it('fetches the keys again for a kid the cache lacks, and verifies the token', async () => {
    const service = new JwksService();
    expect(await service.verifyTransparentToken(await sign(currentPrivateKey, 'desk-2'), [PROVIDER])).toMatchObject({
      ok: true,
    });

    publishedKeys = [currentKey, nextKey];
    const result = await service.verifyTransparentToken(await sign(nextPrivateKey, 'desk-3'), [PROVIDER]);

    expect(result).toMatchObject({ ok: true, sub: 'nour' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('refetches at most once a minute per provider, however many unknown kids arrive', async () => {
    const service = new JwksService();
    await service.getJwksForProvider(PROVIDER);
    const forged = await sign(nextPrivateKey, 'rogue');

    const results = await Promise.all([1, 2, 3].map(() => service.verifyTransparentToken(forged, [PROVIDER])));
    await service.verifyTransparentToken(forged, [PROVIDER]);

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(60_000);
    publishedKeys = [currentKey, nextKey];
    expect(await service.verifyTransparentToken(await sign(nextPrivateKey, 'desk-3'), [PROVIDER])).toMatchObject({
      ok: true,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('never fetches for a provider with inline keys', async () => {
    const service = new JwksService();

    const result = await service.verifyTransparentToken(await sign(nextPrivateKey, 'desk-3'), [
      { id: 'idp', issuerUrl: ISSUER, jwks: { keys: [currentKey] } },
    ]);

    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
