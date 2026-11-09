/**
 * `private_key_jwt` client authentication for CIMD clients (RFC 7523): CimdService.verifyClientAssertion and the
 * key sets it fetches from `jwks_uri`.
 */
import * as dns from 'node:dns';

import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT, type CryptoKey } from 'jose';

import {
  CLIENT_ASSERTION_TYPE_JWT_BEARER,
  MAX_CLIENT_ASSERTION_LIFETIME_SECONDS,
  type ClientAssertionCheck,
} from '../cimd-client-assertion';
import {
  CimdClientAssertionError,
  CimdFetchError,
  CimdResponseTooLargeError,
  CimdSecurityError,
  CimdValidationError,
  type ClientAssertionRefusal,
} from '../cimd.errors';
import { CimdService } from '../cimd.service';
import type { ClientMetadataDocument } from '../cimd.types';

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const mockDnsLookup = dns.promises.lookup as unknown as jest.Mock;

const CLIENT_ID = 'https://client.example.com/oauth/metadata.json';
const JWKS_URI = 'https://client.example.com/oauth/jwks.json';
const TOKEN_ENDPOINT = 'https://mcp.example.com/oauth/token';
const ISSUER = 'https://mcp.example.com';

interface SigningKey {
  alg: string;
  kid: string;
  privateKey: CryptoKey;
  publicJwk: Record<string, unknown>;
}

async function signingKey(alg: 'RS256' | 'ES256', kid: string): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair(alg);
  return { alg, kid, privateKey, publicJwk: { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' } };
}

function document(overrides: Partial<ClientMetadataDocument> = {}): ClientMetadataDocument {
  return {
    client_id: CLIENT_ID,
    client_name: 'Desk companion',
    redirect_uris: ['https://client.example.com/callback'],
    token_endpoint_auth_method: 'private_key_jwt',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    ...overrides,
  };
}

interface AssertionOptions {
  kid?: string;
  alg?: string;
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  jti?: string | null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function assertion(key: SigningKey, options: AssertionOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = {
    iss: options.iss ?? CLIENT_ID,
    sub: options.sub ?? CLIENT_ID,
    aud: options.aud ?? TOKEN_ENDPOINT,
    exp: options.exp ?? nowSeconds() + 60,
    iat: options.iat ?? nowSeconds(),
  };
  if (options.nbf !== undefined) claims['nbf'] = options.nbf;
  if (options.jti !== null) claims['jti'] = options.jti ?? `jti-${Math.random()}`;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: options.alg ?? key.alg, kid: options.kid ?? key.kid })
    .sign(key.privateKey);
}

function check(
  clientAssertion: string | undefined,
  overrides: Partial<ClientAssertionCheck> = {},
): ClientAssertionCheck {
  const claimed = new Set<string>();
  return {
    type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
    assertion: clientAssertion,
    audiences: [TOKEN_ENDPOINT, ISSUER],
    claimOnce: async (key) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    ...overrides,
  };
}

async function refusal(promise: Promise<void>): Promise<ClientAssertionRefusal | string> {
  try {
    await promise;
    return 'accepted';
  } catch (error) {
    return error instanceof CimdClientAssertionError ? error.reason : String(error);
  }
}

describe('CimdService.verifyClientAssertion', () => {
  let service: CimdService;
  let rsaKey: SigningKey;
  let ecKey: SigningKey;
  let otherKey: SigningKey;
  let mockFetch: jest.SpyInstance;

  beforeAll(async () => {
    rsaKey = await signingKey('RS256', 'desk-rsa');
    ecKey = await signingKey('ES256', 'desk-ec');
    otherKey = await signingKey('RS256', 'desk-rsa');
  });

  beforeEach(() => {
    service = new CimdService();
    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    mockFetch.mockRestore();
    jest.restoreAllMocks();
  });

  describe('with inline jwks', () => {
    const inline = () => document({ jwks: { keys: [rsaKey.publicJwk, ecKey.publicJwk] } });

    it('accepts an RS256 assertion naming the token endpoint', async () => {
      await expect(service.verifyClientAssertion(inline(), check(await assertion(rsaKey)))).resolves.toBeUndefined();
    });

    it('accepts an ES256 assertion naming the issuer', async () => {
      const signed = await assertion(ecKey, { aud: ISSUER });

      await expect(service.verifyClientAssertion(inline(), check(signed))).resolves.toBeUndefined();
    });

    it('accepts an assertion whose aud array names this server among others', async () => {
      const signed = await assertion(rsaKey, { aud: ['https://other.example.com', TOKEN_ENDPOINT] });

      await expect(service.verifyClientAssertion(inline(), check(signed))).resolves.toBeUndefined();
    });

    it.each<[string, () => Promise<string | undefined>, ClientAssertionRefusal]>([
      ['no assertion', async () => undefined, 'missing_assertion'],
      ['a token that is not a JWT', async () => 'not-a-jwt', 'malformed'],
      ['a bad signature', () => assertion(otherKey), 'bad_signature'],
      ['a wrong iss', () => assertion(rsaKey, { iss: 'https://attacker.example.com/c.json' }), 'wrong_issuer'],
      ['a wrong sub', () => assertion(rsaKey, { sub: 'https://attacker.example.com/c.json' }), 'wrong_subject'],
      ['a wrong aud', () => assertion(rsaKey, { aud: 'https://other.example.com/oauth/token' }), 'wrong_audience'],
      ['an expired exp', () => assertion(rsaKey, { exp: nowSeconds() - 120, iat: nowSeconds() - 180 }), 'expired'],
      [
        'an exp too far ahead',
        () => assertion(rsaKey, { exp: nowSeconds() + MAX_CLIENT_ASSERTION_LIFETIME_SECONDS + 120 }),
        'lifetime_too_long',
      ],
      ['an nbf in the future', () => assertion(rsaKey, { nbf: nowSeconds() + 300 }), 'not_yet_valid'],
      ['an iat in the future', () => assertion(rsaKey, { iat: nowSeconds() + 300 }), 'not_yet_valid'],
      ['no jti', () => assertion(rsaKey, { jti: null }), 'missing_claim'],
      ['an unknown kid', () => assertion(rsaKey, { kid: 'retired' }), 'unknown_key'],
    ])('refuses %s', async (_label, sign, expected) => {
      await expect(refusal(service.verifyClientAssertion(inline(), check(await sign())))).resolves.toBe(expected);
    });

    it('refuses alg none', async () => {
      const unsigned = new UnsecuredJWT({ jti: 'j1', aud: TOKEN_ENDPOINT })
        .setIssuer(CLIENT_ID)
        .setSubject(CLIENT_ID)
        .setExpirationTime('1m')
        .encode();

      await expect(refusal(service.verifyClientAssertion(inline(), check(unsigned)))).resolves.toBe(
        'unsupported_algorithm',
      );
    });

    it('refuses HS256, even keyed with a symmetric key the document lists', async () => {
      const secret = new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes!!');
      const symmetric = document({
        jwks: { keys: [{ kty: 'oct', k: Buffer.from(secret).toString('base64url'), kid: 'shared' }] },
      });
      const signed = await new SignJWT({ jti: 'j2', aud: TOKEN_ENDPOINT })
        .setProtectedHeader({ alg: 'HS256', kid: 'shared' })
        .setIssuer(CLIENT_ID)
        .setSubject(CLIENT_ID)
        .setExpirationTime('1m')
        .sign(secret);

      await expect(refusal(service.verifyClientAssertion(symmetric, check(signed)))).resolves.toBe(
        'unsupported_algorithm',
      );
    });

    it('refuses an assertion of another type', async () => {
      const signed = await assertion(rsaKey);

      await expect(
        refusal(service.verifyClientAssertion(inline(), check(signed, { type: 'urn:example:saml2-bearer' }))),
      ).resolves.toBe('unsupported_assertion_type');
    });

    it('refuses an oversized assertion before parsing it', async () => {
      await expect(refusal(service.verifyClientAssertion(inline(), check('a'.repeat(20_000))))).resolves.toBe(
        'malformed',
      );
    });

    it('refuses the same jti twice', async () => {
      const replayGuard = check(await assertion(rsaKey, { jti: 'once' }));

      await service.verifyClientAssertion(inline(), replayGuard);

      await expect(refusal(service.verifyClientAssertion(inline(), replayGuard))).resolves.toBe('replayed');
    });

    it('keeps the jti claimed for the assertion lifetime', async () => {
      const claimOnce = jest.fn(async () => true);
      const signed = await assertion(rsaKey, { exp: nowSeconds() + 120 });

      await service.verifyClientAssertion(inline(), check(signed, { claimOnce }));

      const [key, ttlMs] = claimOnce.mock.calls[0] as unknown as [string, number];
      expect(key).toMatch(/^client-assertion:[0-9a-f]{64}$/);
      expect(ttlMs).toBeGreaterThanOrEqual(120_000);
      expect(ttlMs).toBeLessThanOrEqual(151_000);
    });

    it('refuses when the replay guard is unavailable', async () => {
      const signed = await assertion(rsaKey);

      await expect(
        refusal(service.verifyClientAssertion(inline(), check(signed, { claimOnce: async () => false }))),
      ).resolves.toBe('replayed');
    });

    it('refuses when no audience is given to check against', async () => {
      const signed = await assertion(rsaKey);

      await expect(refusal(service.verifyClientAssertion(inline(), check(signed, { audiences: [] })))).resolves.toBe(
        'wrong_audience',
      );
    });
  });

  describe('with jwks_uri', () => {
    const remote = () => document({ jwks_uri: JWKS_URI });
    let publishedKeys: Array<Record<string, unknown>>;

    beforeEach(() => {
      publishedKeys = [rsaKey.publicJwk];
      mockFetch.mockImplementation(async (input: unknown) =>
        String(input) === JWKS_URI
          ? Response.json({ keys: publishedKeys }, { headers: { 'cache-control': 'max-age=600' } })
          : new Response('not found', { status: 404 }),
      );
    });

    it('fetches the key set once and serves later assertions from the cache', async () => {
      await service.verifyClientAssertion(remote(), check(await assertion(rsaKey)));
      await service.verifyClientAssertion(remote(), check(await assertion(rsaKey)));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    });

    it('fetches the key set again for an unknown kid once the cached copy is 30 seconds old', async () => {
      const start = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
      await service.verifyClientAssertion(remote(), check(await assertion(rsaKey)));
      publishedKeys = [rsaKey.publicJwk, ecKey.publicJwk];

      const tooSoon = await refusal(service.verifyClientAssertion(remote(), check(await assertion(ecKey))));
      clock.mockReturnValue(start + 31_000);
      const afterCooldown = await refusal(service.verifyClientAssertion(remote(), check(await assertion(ecKey))));

      expect(tooSoon).toBe('unknown_key');
      expect(afterCooldown).toBe('accepted');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('refuses a key set larger than network.maxResponseSizeBytes', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ keys: [], pad: 'x'.repeat(70_000) })));

      await expect(service.verifyClientAssertion(remote(), check(await assertion(rsaKey)))).rejects.toBeInstanceOf(
        CimdResponseTooLargeError,
      );
    });

    it('refuses a key set whose Content-Length is over the limit, without reading it', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { headers: { 'content-length': '1000000' } }));

      await expect(service.verifyClientAssertion(remote(), check(await assertion(rsaKey)))).rejects.toBeInstanceOf(
        CimdResponseTooLargeError,
      );
    });

    it('refuses when jwks_uri is unreachable', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      await expect(service.verifyClientAssertion(remote(), check(await assertion(rsaKey)))).rejects.toBeInstanceOf(
        CimdFetchError,
      );
    });

    it('refuses when jwks_uri does not answer within network.timeoutMs', async () => {
      const slow = new CimdService(undefined, { network: { timeoutMs: 100 } });
      mockFetch.mockImplementation(
        (_input: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      );

      await expect(slow.verifyClientAssertion(remote(), check(await assertion(rsaKey)))).rejects.toThrow(
        'Request timeout',
      );
    });

    it('refuses a jwks_uri whose host resolves to a private address', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);

      await expect(service.verifyClientAssertion(remote(), check(await assertion(rsaKey)))).rejects.toBeInstanceOf(
        CimdSecurityError,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('refuses a redirect from jwks_uri under the default redirect policy', async () => {
      mockFetch.mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com/jwks.json' } }),
      );

      await expect(service.verifyClientAssertion(remote(), check(await assertion(rsaKey)))).rejects.toBeInstanceOf(
        CimdFetchError,
      );
    });

    it('refuses an answer that is not a key set', async () => {
      mockFetch.mockResolvedValue(Response.json({ keys: 'none' }));

      await expect(service.verifyClientAssertion(remote(), check(await assertion(rsaKey)))).rejects.toBeInstanceOf(
        CimdValidationError,
      );
    });

    it('refuses an error status from jwks_uri', async () => {
      mockFetch.mockResolvedValue(new Response('down', { status: 500 }));

      await expect(service.verifyClientAssertion(remote(), check(await assertion(rsaKey)))).rejects.toBeInstanceOf(
        CimdFetchError,
      );
    });
  });
});

describe('CimdService.assertSupportedClient — token endpoint auth methods', () => {
  const service = new CimdService();
  const keys = { keys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }] };

  it.each<[string, Partial<ClientMetadataDocument>]>([
    ['none', { token_endpoint_auth_method: 'none' }],
    ['private_key_jwt with jwks', { token_endpoint_auth_method: 'private_key_jwt', jwks: keys }],
    ['private_key_jwt with jwks_uri', { token_endpoint_auth_method: 'private_key_jwt', jwks_uri: JWKS_URI }],
  ])('accepts %s', (_label, overrides) => {
    expect(() => service.assertSupportedClient(document(overrides))).not.toThrow();
  });

  it.each<[string, Partial<ClientMetadataDocument>, string]>([
    ['client_secret_post', { token_endpoint_auth_method: 'client_secret_post' }, 'only "none" or "private_key_jwt"'],
    ['client_secret_basic', { token_endpoint_auth_method: 'client_secret_basic' }, 'only "none" or "private_key_jwt"'],
    ['private_key_jwt without keys', { token_endpoint_auth_method: 'private_key_jwt' }, 'exactly one of'],
    [
      'private_key_jwt with both jwks and jwks_uri',
      { token_endpoint_auth_method: 'private_key_jwt', jwks: keys, jwks_uri: JWKS_URI },
      'exactly one of',
    ],
    [
      'private_key_jwt with an http jwks_uri',
      { token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'http://client.example.com/jwks.json' },
      'jwks_uri is not allowed',
    ],
    [
      'private_key_jwt with a jwks_uri on a private address',
      { token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'https://10.0.0.7/jwks.json' },
      'jwks_uri is not allowed',
    ],
  ])('refuses %s', (_label, overrides, message) => {
    const thrown = (() => {
      try {
        service.assertSupportedClient(document({ jwks: undefined, ...overrides }));
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).toBeInstanceOf(CimdValidationError);
    expect((thrown as CimdValidationError).message).toContain(message);
  });
});
