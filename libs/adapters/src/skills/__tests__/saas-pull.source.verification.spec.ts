/**
 * The `saas` source checks the SaaS it pulls from: `jwksUrl`, `expectedIssuer` and
 * `expectedAudience` are enforced on the pinned pull token before any bundle is used.
 * In 1.8.2 all three were ignored (the audience only named the cache file), so a
 * token from another issuer, for another audience, or signed by an unknown key
 * pulled and applied the bundle all the same.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ResolvedBundle } from '../bundle/bundle.types';
import type { SaasSourceOptions } from '../source-options';
import { SaasJwksUnavailableError, SaasPullSource, SaasPullTokenRejectedError } from '../sources/saas-pull.source';
import {
  createSaasTokenIssuer,
  SAAS_AUDIENCE,
  SAAS_ISSUER,
  SAAS_JWKS_URL,
  type SaasTokenIssuer,
} from './saas-token.fixture';

const ENDPOINT = 'https://cloud.example.dev/v1/bundles/acme';

const bundle = {
  schemaVersion: 1,
  bundleId: 'saas:test',
  version: '1',
  generatedAt: '2026-05-04T00:00:00Z',
  sourceDigest: 'd'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'https://example.com' }],
  authBindings: { def: { kind: 'none' as const } },
  skills: [{ id: 's', name: 'S', description: 'd', instructions: '# X', operationIds: [] }],
  operations: {},
};

const logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

type Stub = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

class StubbedSaasSource extends SaasPullSource {
  constructor(
    options: SaasSourceOptions,
    cacheDir: string,
    private readonly stub: Stub,
  ) {
    super(options, cacheDir, logger);
  }
  protected override async httpGet(url: string, headers: Record<string, string>) {
    return this.stub(url, headers);
  }
}

/** A SaaS that serves `jwks` at the JWKS URL and the bundle at the endpoint. */
function saas(jwks: unknown, requests: string[] = []): Stub {
  return async (url) => {
    requests.push(url);
    if (url === SAAS_JWKS_URL) return { status: 200, body: JSON.stringify(jwks) };
    if (url === ENDPOINT) return { status: 200, body: JSON.stringify(bundle) };
    return { status: 404, body: '' };
  };
}

const options = (authToken: string, overrides: Partial<SaasSourceOptions> = {}): SaasSourceOptions => ({
  type: 'saas',
  endpoint: ENDPOINT,
  authToken,
  expectedAudience: SAAS_AUDIENCE,
  pollIntervalMs: 60_000,
  enableWebhook: false,
  jwksUrl: SAAS_JWKS_URL,
  expectedIssuer: SAAS_ISSUER,
  ...overrides,
});

async function startAndCollect(source: SaasPullSource): Promise<{ bundles: ResolvedBundle[]; error?: Error }> {
  const bundles: ResolvedBundle[] = [];
  source.onChange((b) => bundles.push(b));
  let error: Error | undefined;
  try {
    await source.start();
  } catch (e) {
    error = e as Error;
  } finally {
    await source.stop();
  }
  return { bundles, error };
}

describe('SaasPullSource verifies the SaaS with jwksUrl, expectedIssuer and expectedAudience', () => {
  let issuer: SaasTokenIssuer;
  let cacheDir: string;

  beforeAll(async () => {
    issuer = await createSaasTokenIssuer();
  });

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saas-verify-'));
  });

  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('pulls the bundle with a token the issuer signed for this audience', async () => {
    const requests: string[] = [];
    const source = new StubbedSaasSource(options(await issuer.token()), cacheDir, saas(issuer.jwks, requests));

    const { bundles, error } = await startAndCollect(source);

    expect(error).toBeUndefined();
    expect(bundles.map((b) => b.bundleId)).toEqual(['saas:test']);
    expect(requests).toEqual([SAAS_JWKS_URL, ENDPOINT]);
  });

  it('does not send the pull token to the JWKS URL', async () => {
    const seen: Record<string, Record<string, string>> = {};
    const source = new StubbedSaasSource(options(await issuer.token()), cacheDir, async (url, headers) => {
      seen[url] = headers;
      return saas(issuer.jwks)(url, headers);
    });

    await startAndCollect(source);

    expect(seen[SAAS_JWKS_URL]?.['Authorization']).toBeUndefined();
  });

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it.each([
    ['another issuer', 'wrong_issuer', async () => issuer.token({ iss: 'https://evil.example' })],
    ['no issuer', 'wrong_issuer', async () => issuer.token({ iss: undefined })],
    ['another audience', 'wrong_audience', async () => issuer.token({ aud: 'other-customer:prod' })],
    ['no audience', 'wrong_audience', async () => issuer.token({ aud: undefined })],
    ['another resource', 'wrong_audience', async () => issuer.token({ resource: 'https://other.example' })],
    ['an expired token', 'expired', async () => issuer.token({ exp: nowSeconds() - 60 })],
    ['a token not valid yet', 'not_yet_valid', async () => issuer.token({ nbf: nowSeconds() + 600 })],
    ['a kid the JWKS does not publish', 'unknown_key', async () => (await createSaasTokenIssuer('saas-2027')).token()],
    [
      'a key the JWKS does not publish',
      'bad_signature',
      async () => (await createSaasTokenIssuer('saas-2026')).token(),
    ],
    ['a token that is not a JWT', 'malformed', async () => 'opaque-pull-token'],
  ])('refuses a pull token with %s (%s): no request to the endpoint, no bundle', async (_label, failure, makeToken) => {
    const requests: string[] = [];
    const source = new StubbedSaasSource(options(await makeToken()), cacheDir, saas(issuer.jwks, requests));

    const { bundles, error } = await startAndCollect(source);

    expect(bundles).toEqual([]);
    expect(error).toBeInstanceOf(SaasPullTokenRejectedError);
    expect(error).toMatchObject({ tokenFailure: failure, message: expect.stringMatching(/pull token rejected/) });
    expect(requests).not.toContain(ENDPOINT);
  });

  it('keeps the message clients may read as it was: it does not name the check that failed', async () => {
    const source = new StubbedSaasSource(
      options(await issuer.token({ exp: nowSeconds() - 60 })),
      cacheDir,
      saas(issuer.jwks),
    );

    const { error } = await startAndCollect(source);

    expect(error?.message).toMatch(/^\[saas-source\] pull token rejected: not a valid token from issuer /);
    expect(error?.message).not.toContain('expired');
  });

  it('logs the check the pull token failed, with the source id, at warn level and without the token', async () => {
    const token = await issuer.token({ iss: 'https://evil.example' });
    const warn = jest.mocked((logger as unknown as { warn: jest.Mock }).warn);
    warn.mockClear();
    const source = new StubbedSaasSource(options(token), cacheDir, saas(issuer.jwks));

    await startAndCollect(source);

    expect(warn).toHaveBeenCalledWith(`[saas-source] saas:${ENDPOINT}: pull token check failed (wrong_issuer)`);
    expect(warn.mock.calls.flat().join('\n')).not.toContain(token);
  });

  it('names an unreachable JWKS jwks_unavailable, in the log and on the error, and does not take it for a bad token', async () => {
    const warn = jest.mocked((logger as unknown as { warn: jest.Mock }).warn);
    warn.mockClear();
    const source = new StubbedSaasSource(options(await issuer.token()), cacheDir, async () => {
      throw new TypeError('fetch failed');
    });

    const { error } = await startAndCollect(source);

    expect(error?.message).toContain('fetch failed');
    expect(error).not.toBeInstanceOf(SaasPullTokenRejectedError);
    expect(warn).toHaveBeenCalledWith(`[saas-source] saas:${ENDPOINT}: pull token check failed (jwks_unavailable)`);
  });

  it.each([
    ['answers 503', async () => ({ status: 503, body: '' })],
    ['is not JSON', async () => ({ status: 200, body: '<html>' })],
    ['has no keys', async () => ({ status: 200, body: '{"keys":[]}' })],
    ['has no usable signing key', async () => ({ status: 200, body: '{"keys":[{}]}' })],
    [
      'has only an encryption key',
      async () => ({
        status: 200,
        body: JSON.stringify({ keys: [{ kty: 'RSA', n: 'AQAB', e: 'AQAB', key_ops: ['encrypt'] }] }),
      }),
    ],
  ])('throws SaasJwksUnavailableError when the JWKS %s', async (_label, stub) => {
    const source = new StubbedSaasSource(options(await issuer.token()), cacheDir, stub);

    await expect(source.refresh()).rejects.toBeInstanceOf(SaasJwksUnavailableError);
    await expect(source.refresh()).rejects.toMatchObject({ tokenFailure: 'jwks_unavailable' });
    await source.stop();
  });

  it('does not fall back to the cached bundle when the pull token is rejected', async () => {
    await fs.writeFile(path.join(cacheDir, 'acme_prod.json'), JSON.stringify(bundle), 'utf8');
    const source = new StubbedSaasSource(
      options(await issuer.token({ iss: 'https://evil.example' })),
      cacheDir,
      saas(issuer.jwks),
    );

    const { bundles, error } = await startAndCollect(source);

    expect(bundles).toEqual([]);
    expect(error?.message).toMatch(/pull token rejected/);
  });

  it('still falls back to the cached bundle when the JWKS is unreachable at startup (a SaaS outage)', async () => {
    await fs.writeFile(path.join(cacheDir, 'acme_prod.json'), JSON.stringify(bundle), 'utf8');
    const source = new StubbedSaasSource(options(await issuer.token()), cacheDir, async () => ({
      status: 503,
      body: '',
    }));

    const { bundles, error } = await startAndCollect(source);

    expect(error).toBeUndefined();
    expect(bundles.map((b) => b.bundleId)).toEqual(['saas:test']);
  });

  // A JWKS with no key that could verify a token is an unusable JWKS (like an unreachable one),
  // not a verdict on the token: the pull fails and the cached bundle is still the fallback.
  it.each([
    ['an empty key object', { keys: [{}] }],
    ['an RSA key without its modulus', { keys: [{ kty: 'RSA', kid: 'saas-2026', e: 'AQAB' }] }],
    ['only a symmetric key', { keys: [{ kty: 'oct', kid: 'saas-2026', k: 'c2VjcmV0' }] }],
    ['only an encryption key', { keys: [{ kty: 'EC', use: 'enc', crv: 'P-256', x: 'eA', y: 'eQ' }] }],
    ['keys that are not objects', { keys: ['saas-2026', null] }],
    ['a key type named after an Object.prototype member', { keys: [{ kty: 'constructor', n: 'x', e: 'AQAB' }] }],
  ])('falls back to the cached bundle when the JWKS has %s', async (_label, jwks) => {
    await fs.writeFile(path.join(cacheDir, 'acme_prod.json'), JSON.stringify(bundle), 'utf8');
    const requests: string[] = [];
    const source = new StubbedSaasSource(options(await issuer.token()), cacheDir, saas(jwks, requests));

    const { bundles, error } = await startAndCollect(source);

    expect(error).toBeUndefined();
    expect(bundles.map((b) => b.bundleId)).toEqual(['saas:test']);
    expect(requests).not.toContain(ENDPOINT);
  });

  it('still refuses a token signed by a key a usable JWKS does not publish, with a cached bundle present', async () => {
    await fs.writeFile(path.join(cacheDir, 'acme_prod.json'), JSON.stringify(bundle), 'utf8');
    const other = await createSaasTokenIssuer('saas-2026');
    const source = new StubbedSaasSource(
      options(await other.token()),
      cacheDir,
      // A usable key next to an unusable one: the JWKS is usable, so this is a verdict on the token.
      saas({ keys: [{}, ...issuer.jwks.keys] }),
    );

    const { bundles, error } = await startAndCollect(source);

    expect(bundles).toEqual([]);
    expect(error?.message).toMatch(/pull token rejected/);
  });

  it('refuses a refresh() whose pull token was rejected', async () => {
    const source = new StubbedSaasSource(
      options(await issuer.token({ aud: 'other-customer:prod' })),
      cacheDir,
      saas(issuer.jwks),
    );
    const bundles: ResolvedBundle[] = [];
    source.onChange((b) => bundles.push(b));

    await expect(source.refresh()).rejects.toThrow(/pull token rejected/);
    expect(bundles).toEqual([]);
    await source.stop();
  });
});
