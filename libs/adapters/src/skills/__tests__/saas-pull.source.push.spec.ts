// With enableWebhook, the saas source checks a pushed bundle's token as it checks the pull token, plus its iat and jti.
import { createMemoryStorage, createStorage } from '@frontmcp/utils';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { StorageReplayNonceStore, type ReplayNonceStore } from '../security/replay-nonce-store';
import type { SaasSourceOptions } from '../source-options';
import type { BundleCacheStore } from '../sources';
import {
  SaasJwksUnavailableError,
  SaasPullSource,
  SaasPushRefusedError,
  tokenFailureOf,
} from '../sources/saas-pull.source';
import {
  createSaasTokenIssuer,
  SAAS_AUDIENCE,
  SAAS_ISSUER,
  SAAS_JWKS_URL,
  type SaasTokenIssuer,
} from './saas-token.fixture';

jest.mock('@frontmcp/utils', () => ({ ...jest.requireActual('@frontmcp/utils'), createStorage: jest.fn() }));

const logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

type Stub = (url: string) => Promise<{ status: number; body: string }>;

class StubbedSaasSource extends SaasPullSource {
  constructor(
    options: SaasSourceOptions,
    private readonly stub: Stub,
    cache?: BundleCacheStore,
    pushReplayStore?: ReplayNonceStore,
  ) {
    super(options, undefined, logger, { cache, disablePolling: true, pushReplayStore });
  }
  protected override async httpGet(url: string) {
    return this.stub(url);
  }
}

function sourceOptions(enableWebhook: boolean): SaasSourceOptions {
  return {
    type: 'saas',
    endpoint: 'https://cloud.example.dev/v1/bundles/acme',
    authToken: 'pinned-pull-token',
    expectedAudience: SAAS_AUDIENCE,
    pollIntervalMs: 60_000,
    enableWebhook,
    jwksUrl: SAAS_JWKS_URL,
    expectedIssuer: SAAS_ISSUER,
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('SaasPullSource push checks', () => {
  let issuer: SaasTokenIssuer;
  let source: StubbedSaasSource;
  const cache = { read: jest.fn(), write: jest.fn(async () => undefined) };

  beforeAll(async () => {
    issuer = await createSaasTokenIssuer();
  });

  beforeEach(() => {
    cache.write.mockClear();
    source = new StubbedSaasSource(
      sourceOptions(true),
      async (url) =>
        url === SAAS_JWKS_URL ? { status: 200, body: JSON.stringify(issuer.jwks) } : { status: 404, body: '' },
      cache,
    );
  });

  const refusalOf = async (token: string): Promise<SaasPushRefusedError> => {
    const error = await source.verifyPushToken(token).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(SaasPushRefusedError);
    return error as SaasPushRefusedError;
  };

  it('accepts a token from the issuer, for the audience, with a fresh jti and iat', async () => {
    await expect(source.verifyPushToken(await issuer.token({ jti: 'push-0001' }))).resolves.toBeUndefined();
  });

  it('offers the push checks only with enableWebhook', () => {
    const pullOnly = new StubbedSaasSource(sourceOptions(false), async () => ({ status: 404, body: '' }));

    expect(source.push).toBe(source);
    expect(pullOnly.push).toBeUndefined();
  });

  it('refuses every push token when enableWebhook is off', async () => {
    const pullOnly = new StubbedSaasSource(sourceOptions(false), async () => ({ status: 404, body: '' }));

    const error = await pullOnly.verifyPushToken(await issuer.token({ jti: 'push-0002' })).catch((e: unknown) => e);

    expect(error).toMatchObject({ refusal: 'invalid-token', message: expect.stringContaining('enableWebhook is off') });
  });

  it('refuses a replayed jti', async () => {
    const token = await issuer.token({ jti: 'push-0003' });
    await source.verifyPushToken(token);

    const refused = await refusalOf(token);

    expect(refused.refusal).toBe('replayed');
    expect(refused.message).toContain('nonce replay');
  });

  it.each([
    ['another audience', { jti: 'push-0004', aud: 'someone-else' }, '"aud" claim does not include', 'wrong_audience'],
    [
      'another resource',
      { jti: 'push-0005', resource: 'https://other.example' },
      '"resource" claim does not include',
      'wrong_audience',
    ],
    [
      'another issuer',
      { jti: 'push-0006', iss: 'https://evil.example' },
      'not a valid token from issuer',
      'wrong_issuer',
    ],
    ['an expired token', { jti: 'push-0011', exp: nowSeconds() - 60 }, 'not a valid token from issuer', 'expired'],
    ['no jti', {}, 'needs "iat" and "jti" claims', 'missing_claim'],
    ['an iat ten minutes old', { jti: 'push-0007', iat: nowSeconds() - 600 }, 'outside', undefined],
    ['a short jti', { jti: 'short' }, 'nonce too short', undefined],
  ])('refuses a token with %s as an invalid token', async (_label, claims, reason, tokenFailure) => {
    const refused = await refusalOf(await issuer.token(claims));

    expect(refused.refusal).toBe('invalid-token');
    expect(refused.message).toContain(reason);
    expect(refused.tokenFailure).toBe(tokenFailure);
    expect(tokenFailureOf(refused)).toBe(tokenFailure);
  });

  it('names the check that refused the token in its message, for the log', async () => {
    const refused = await refusalOf(await issuer.token({ jti: 'push-0012', iss: 'https://evil.example' }));

    expect(refused.message).toMatch(/^\[saas-source\] push refused \(wrong_issuer\): not a valid token from issuer/);
  });

  it('names the token check of an error that wraps one', () => {
    const wrapped = new Error('initial pull failed and no cached bundle is available', {
      cause: new SaasJwksUnavailableError('JWKS https://saas.example/jwks responded 503'),
    });

    expect(tokenFailureOf(wrapped)).toBe('jwks_unavailable');
  });

  it('names no token check for an error that is not one', () => {
    expect(tokenFailureOf(new Error('pull responded 502'))).toBeUndefined();
    expect(tokenFailureOf('not an error')).toBeUndefined();
  });

  describe('with a replay store shared by several sources', () => {
    const servingJwks: Stub = async (url) =>
      url === SAAS_JWKS_URL ? { status: 200, body: JSON.stringify(issuer.jwks) } : { status: 404, body: '' };

    const replicaSharing = (store: ReplayNonceStore) =>
      new StubbedSaasSource(sourceOptions(true), servingJwks, undefined, store);

    it('refuses, on a second replica, a jti a push to the first replica used', async () => {
      const storage = createMemoryStorage({ enableSweeper: false });
      await storage.connect();
      const shared = new StorageReplayNonceStore(storage);
      const token = await issuer.token({ jti: 'push-shared-1' });
      await replicaSharing(shared).verifyPushToken(token);

      const replayed = await replicaSharing(shared)
        .verifyPushToken(token)
        .catch((e: unknown) => e);

      expect(replayed).toMatchObject({ refusal: 'replayed', message: expect.stringContaining('nonce replay') });
    });

    it('refuses the push, as unchecked, when the replay store fails', async () => {
      const failing = { claim: jest.fn(async () => Promise.reject(new Error('ECONNREFUSED 10.0.0.7:6379'))) };

      const error = await replicaSharing(failing)
        .verifyPushToken(await issuer.token({ jti: 'push-shared-2' }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SaasPushRefusedError);
      expect(error).toMatchObject({
        refusal: 'replay-unchecked',
        message: expect.stringContaining('the replay store failed: ECONNREFUSED'),
      });
    });

    it('keeps the jtis in the storage pushReplayStorage names, under its audience, never falling back to memory', async () => {
      const storage = createMemoryStorage({ enableSweeper: false });
      await storage.connect();
      jest.mocked(createStorage).mockResolvedValue(storage);
      const pushReplayStorage = { type: 'redis' as const, redis: { url: 'redis://replay.internal:6379' } };
      const replica = () => new StubbedSaasSource({ ...sourceOptions(true), pushReplayStorage }, servingJwks);
      const token = await issuer.token({ jti: 'push-shared-3' });

      await replica().verifyPushToken(token);
      const replayed = await replica()
        .verifyPushToken(token)
        .catch((e: unknown) => e);

      expect(replayed).toMatchObject({ refusal: 'replayed' });
      expect(createStorage).toHaveBeenCalledWith({ ...pushReplayStorage, fallback: 'error' });
      expect(await storage.keys('*')).toEqual([
        expect.stringMatching(new RegExp(`^frontmcp:skilled-openapi:push-jti:${SAAS_AUDIENCE}:[0-9a-f]{64}$`)),
      ]);
    });

    it('uses an injected pushReplayStore rather than the storage pushReplayStorage names', async () => {
      const injected = { claim: jest.fn(async () => true) };
      const options = { ...sourceOptions(true), pushReplayStorage: { type: 'redis' as const } };
      jest.mocked(createStorage).mockClear();

      await new StubbedSaasSource(options, servingJwks, undefined, injected).verifyPushToken(
        await issuer.token({ jti: 'push-shared-4' }),
      );

      expect(injected.claim).toHaveBeenCalledTimes(1);
      expect(createStorage).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['a key the JWKS does not hold, under a kid it publishes', 'saas-2026', 'bad_signature'],
    ['a kid the JWKS does not publish', 'saas-2027', 'unknown_key'],
  ])('refuses a token signed by %s', async (_label, kid, tokenFailure) => {
    const stranger = await createSaasTokenIssuer(kid);

    const refused = await refusalOf(await stranger.token({ jti: `push-0008-${kid}` }));

    expect(refused).toMatchObject({ refusal: 'invalid-token', tokenFailure });
  });

  it('throws SaasJwksUnavailableError, not a refusal, when the JWKS cannot be read', async () => {
    const offline = new StubbedSaasSource(sourceOptions(true), async () => ({ status: 503, body: '' }));

    const error = await offline.verifyPushToken(await issuer.token({ jti: 'push-0009' })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SaasJwksUnavailableError);
    expect(error).not.toBeInstanceOf(SaasPushRefusedError);
    expect(error).toMatchObject({
      tokenFailure: 'jwks_unavailable',
      message: expect.stringContaining('responded 503'),
    });
    expect(tokenFailureOf(error)).toBe('jwks_unavailable');
  });

  it('reads the JWKS once for concurrent pushes, reuses it for a minute, and never caches a failed read', async () => {
    let jwksReads = 0;
    let jwksAvailable = true;
    const counted = new StubbedSaasSource(sourceOptions(true), async (url) => {
      if (url !== SAAS_JWKS_URL) return { status: 404, body: '' };
      jwksReads++;
      return jwksAvailable ? { status: 200, body: JSON.stringify(issuer.jwks) } : { status: 503, body: '' };
    });
    const stranger = await createSaasTokenIssuer();
    const strangerTokens = await Promise.all([1, 2, 3, 4, 5].map((n) => stranger.token({ jti: `junk-${n}` })));

    await Promise.all(strangerTokens.map((token) => counted.verifyPushToken(token).catch(() => undefined)));
    await counted.verifyPushToken(await issuer.token({ jti: 'push-0010' }));
    expect(jwksReads).toBe(1);

    const later = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    try {
      jwksAvailable = false;
      await expect(counted.verifyPushToken(strangerTokens[0])).rejects.toThrow('responded 503');
      jwksAvailable = true;
      await expect(counted.verifyPushToken(strangerTokens[1])).rejects.toBeInstanceOf(SaasPushRefusedError);
    } finally {
      later.mockRestore();
    }
    expect(jwksReads).toBe(3);
  });

  it('keeps a bundle it is asked to keep in the bundle cache', async () => {
    const bundle = { bundleId: 'saas:test', version: '2' } as ResolvedBundle;

    await source.keepBundle(bundle);

    expect(cache.write).toHaveBeenCalledWith(bundle);
  });
});
