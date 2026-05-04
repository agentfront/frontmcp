import type { JwksService } from '@frontmcp/auth';

import { BundlePushJwtVerifier } from '../security/jwt-verifier';

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

function makeJwksStub(payload: Record<string, unknown> | { error: string }): JwksService {
  return {
    verifyTransparentToken: jest.fn(async () => {
      if ('error' in payload) return { ok: false, error: (payload as { error: string }).error };
      return { ok: true, issuer: 'https://issuer', payload };
    }),
  } as unknown as JwksService;
}

const baseOpts = {
  expectedIssuer: 'https://issuer',
  expectedAudience: 'acme:prod',
  expectedResource: 'https://customer.example/mcp',
  jwksUri: 'https://issuer/.well-known/jwks.json',
};

describe('BundlePushJwtVerifier', () => {
  it('rejects when token is null/undefined (non-string)', async () => {
    const v = new BundlePushJwtVerifier(baseOpts, fakeLogger, makeJwksStub({}));
    const r = await v.verify(undefined as never);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/missing/);
  });

  it('rejects when JwksService throws', async () => {
    const throwing = {
      verifyTransparentToken: jest.fn(async () => {
        throw new Error('network down');
      }),
    } as unknown as import('@frontmcp/auth').JwksService;
    const v = new BundlePushJwtVerifier(baseOpts, fakeLogger, throwing);
    const r = await v.verify('t');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/verify failed/);
  });

  it('accepts a token whose iss/aud/resource/role all check', async () => {
    const v = new BundlePushJwtVerifier(
      baseOpts,
      fakeLogger,
      makeJwksStub({
        iss: 'https://issuer',
        aud: 'acme:prod',
        resource: 'https://customer.example/mcp',
        roles: ['frontmcp:cloud:push'],
      }),
    );
    const r = await v.verify('any.signed.token');
    expect(r.ok).toBe(true);
  });

  it('rejects when token is missing', async () => {
    const v = new BundlePushJwtVerifier(baseOpts, fakeLogger, makeJwksStub({}));
    const r = await v.verify('');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/missing/);
  });

  it('rejects when JwksService returns ok=false', async () => {
    const v = new BundlePushJwtVerifier(baseOpts, fakeLogger, makeJwksStub({ error: 'no_provider_verified' }));
    const r = await v.verify('bad.token');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no_provider_verified/);
  });

  it('rejects when audience does not match', async () => {
    const v = new BundlePushJwtVerifier(
      baseOpts,
      fakeLogger,
      makeJwksStub({
        aud: 'someone-else',
        resource: 'https://customer.example/mcp',
        roles: ['frontmcp:cloud:push'],
      }),
    );
    const r = await v.verify('t');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/aud mismatch/);
  });

  it('accepts when aud is a string array containing the expected audience', async () => {
    const v = new BundlePushJwtVerifier(
      baseOpts,
      fakeLogger,
      makeJwksStub({
        aud: ['x', 'acme:prod', 'y'],
        resource: 'https://customer.example/mcp',
        roles: ['frontmcp:cloud:push'],
      }),
    );
    const r = await v.verify('t');
    expect(r.ok).toBe(true);
  });

  it('rejects when RFC 8707 resource indicator is missing', async () => {
    const v = new BundlePushJwtVerifier(
      baseOpts,
      fakeLogger,
      makeJwksStub({
        aud: 'acme:prod',
        roles: ['frontmcp:cloud:push'],
      }),
    );
    const r = await v.verify('t');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/RFC 8707/);
  });

  it('rejects when RFC 8707 resource indicator does not match', async () => {
    const v = new BundlePushJwtVerifier(
      baseOpts,
      fakeLogger,
      makeJwksStub({
        aud: 'acme:prod',
        resource: 'https://different/mcp',
        roles: ['frontmcp:cloud:push'],
      }),
    );
    const r = await v.verify('t');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/RFC 8707/);
  });

  it('rejects when no required role is present', async () => {
    const v = new BundlePushJwtVerifier(
      baseOpts,
      fakeLogger,
      makeJwksStub({
        aud: 'acme:prod',
        resource: 'https://customer.example/mcp',
        roles: ['some:other:role'],
      }),
    );
    const r = await v.verify('t');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/required role/);
  });

  it('accepts when at least one required role matches a space-delimited claim', async () => {
    const v = new BundlePushJwtVerifier(
      baseOpts,
      fakeLogger,
      makeJwksStub({
        aud: 'acme:prod',
        resource: 'https://customer.example/mcp',
        roles: 'unrelated frontmcp:cloud:push other',
      }),
    );
    const r = await v.verify('t');
    expect(r.ok).toBe(true);
  });

  it('honors custom requiredScopes', async () => {
    const v = new BundlePushJwtVerifier(
      { ...baseOpts, requiredScopes: ['bundles:push'] },
      fakeLogger,
      makeJwksStub({
        aud: 'acme:prod',
        resource: 'https://customer.example/mcp',
        roles: ['frontmcp:cloud:push'],
        scope: 'bundles:push other',
      }),
    );
    const r = await v.verify('t');
    expect(r.ok).toBe(true);
  });

  it('rejects when scope claim missing required scope', async () => {
    const v = new BundlePushJwtVerifier(
      { ...baseOpts, requiredScopes: ['bundles:push'] },
      fakeLogger,
      makeJwksStub({
        aud: 'acme:prod',
        resource: 'https://customer.example/mcp',
        roles: ['frontmcp:cloud:push'],
        scope: 'something:else',
      }),
    );
    const r = await v.verify('t');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/required scope/);
  });
});
