import { createBundleSource, NpmSource, SaasPullSource, StaticSource } from '../sources';

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

describe('createBundleSource', () => {
  it('returns a StaticSource for type=static', () => {
    const s = createBundleSource({ type: 'static', path: '/x', watch: false }, undefined, fakeLogger);
    expect(s).toBeInstanceOf(StaticSource);
  });

  it('returns an NpmSource for type=npm', () => {
    const s = createBundleSource({ type: 'npm', packageName: '@x/y', verifyProvenance: false }, undefined, fakeLogger);
    expect(s).toBeInstanceOf(NpmSource);
  });

  it('returns a SaasPullSource for type=saas', () => {
    const s = createBundleSource(
      {
        type: 'saas',
        endpoint: 'https://cloud.example.dev/v1/x',
        authToken: 'tok',
        expectedAudience: 'aud',
        pollIntervalMs: 60_000,
        enableWebhook: false,
        jwksUrl: 'https://cloud.example.dev/jwks',
        expectedIssuer: 'https://cloud.example.dev',
      },
      '/tmp/cache',
      fakeLogger,
    );
    expect(s).toBeInstanceOf(SaasPullSource);
  });
});

describe('the version order of each source', () => {
  const saas = {
    type: 'saas' as const,
    endpoint: 'https://cloud.example.dev/v1/x',
    authToken: 'tok',
    expectedAudience: 'aud',
    pollIntervalMs: 60_000,
    enableWebhook: false,
    jwksUrl: 'https://cloud.example.dev/jwks',
    expectedIssuer: 'https://cloud.example.dev',
  };

  it('is forward only for a saas source, unless it allows a rollback', () => {
    const forwardOnly = createBundleSource(saas, undefined, fakeLogger);
    const allowingRollback = createBundleSource({ ...saas, allowRollback: true }, undefined, fakeLogger);

    expect(forwardOnly.forwardOnly).toBe(true);
    expect(allowingRollback.forwardOnly).toBe(false);
  });

  it('is not set for the static, npm and inline sources, whose bundles the developer picks', () => {
    const sources = [
      createBundleSource({ type: 'static', path: '/x', watch: true }, undefined, fakeLogger),
      createBundleSource({ type: 'npm', packageName: '@x/y', verifyProvenance: false }, undefined, fakeLogger),
      createBundleSource({ type: 'inline', content: {} }, undefined, fakeLogger),
    ];

    expect(sources.map((source) => source.forwardOnly)).toEqual([undefined, undefined, undefined]);
  });
});
