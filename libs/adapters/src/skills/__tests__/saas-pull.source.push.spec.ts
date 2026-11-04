// With enableWebhook, the saas source checks a pushed bundle's token as it checks the pull token, plus its iat and jti.
import type { ResolvedBundle } from '../bundle/bundle.types';
import type { SaasSourceOptions } from '../source-options';
import type { BundleCacheStore } from '../sources';
import { SaasPullSource, SaasPushRefusedError } from '../sources/saas-pull.source';
import {
  createSaasTokenIssuer,
  SAAS_AUDIENCE,
  SAAS_ISSUER,
  SAAS_JWKS_URL,
  type SaasTokenIssuer,
} from './saas-token.fixture';

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
  ) {
    super(options, undefined, logger, { cache, disablePolling: true });
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
    ['another audience', { jti: 'push-0004', aud: 'someone-else' }, '"aud" claim does not include'],
    ['another resource', { jti: 'push-0005', resource: 'https://other.example' }, '"resource" claim does not include'],
    ['another issuer', { jti: 'push-0006', iss: 'https://evil.example' }, 'not a valid token from issuer'],
    ['no jti', {}, 'needs "iat" and "jti" claims'],
    ['an iat ten minutes old', { jti: 'push-0007', iat: nowSeconds() - 600 }, 'outside'],
    ['a short jti', { jti: 'short' }, 'nonce too short'],
  ])('refuses a token with %s as an invalid token', async (_label, claims, reason) => {
    const refused = await refusalOf(await issuer.token(claims));

    expect(refused.refusal).toBe('invalid-token');
    expect(refused.message).toContain(reason);
  });

  it('refuses a token signed by a key the JWKS does not hold', async () => {
    const stranger = await createSaasTokenIssuer();

    const refused = await refusalOf(await stranger.token({ jti: 'push-0008' }));

    expect(refused.refusal).toBe('invalid-token');
  });

  it('throws a plain error, not a refusal, when the JWKS cannot be read', async () => {
    const offline = new StubbedSaasSource(sourceOptions(true), async () => ({ status: 503, body: '' }));

    const error = await offline.verifyPushToken(await issuer.token({ jti: 'push-0009' })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SaasPushRefusedError);
    expect((error as Error).message).toContain('responded 503');
  });

  it('keeps an applied pushed bundle in the bundle cache', async () => {
    const bundle = { bundleId: 'saas:test', version: '2' } as ResolvedBundle;

    await source.keepBundle(bundle);

    expect(cache.write).toHaveBeenCalledWith(bundle);
  });
});
