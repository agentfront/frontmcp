import { OverlayParseError } from '@frontmcp/adapters/skills';

import { bundleHealth, describeLoadError, publicLoadFailureReason } from '../sync/bundle-load-state';

describe('describeLoadError', () => {
  it('adds the first three issues a bundle check found to its message', () => {
    const error = new OverlayParseError('Bundle schema validation failed (4 issue(s))', [
      'a: x',
      'b: y',
      'c: z',
      'd: w',
    ]);

    expect(describeLoadError(error)).toBe('Bundle schema validation failed (4 issue(s)): a: x; b: y; c: z');
  });

  it('is the message of any other error, and the text of a thrown value that is not one', () => {
    expect(describeLoadError(new Error('pull responded 401'))).toBe('pull responded 401');
    expect(describeLoadError('offline')).toBe('offline');
  });
});

describe('publicLoadFailureReason', () => {
  it('keeps the first line only', () => {
    expect(publicLoadFailureReason('Overlay YAML parse failed: bad indentation\n 3 | secret: value')).toBe(
      'Overlay YAML parse failed: bad indentation',
    );
  });

  it('cuts a URL to its scheme, host and path, dropping its credentials, query and fragment', () => {
    expect(
      publicLoadFailureReason('JWKS https://user:pass@issuer.example.dev:8443/keys.json?token=abc#k1 responded 500'),
    ).toBe('JWKS https://issuer.example.dev:8443/keys.json responded 500');
  });

  it('removes a token', () => {
    expect(publicLoadFailureReason('pull token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln rejected')).toBe(
      'pull token [token] rejected',
    );
  });

  it('removes an absolute file path, and keeps the host and path of a URL', () => {
    expect(publicLoadFailureReason("ENOENT: no such file or directory, open '/srv/app/billing.bundle.json'")).toBe(
      "ENOENT: no such file or directory, open '[path]'",
    );
    expect(publicLoadFailureReason('EACCES: permission denied, open C:\\bundles\\billing.json')).toBe(
      'EACCES: permission denied, open [path]',
    );
    expect(publicLoadFailureReason('pull https://bundles.example/v1/billing.json responded 404')).toBe(
      'pull https://bundles.example/v1/billing.json responded 404',
    );
  });

  it('caps a long reason', () => {
    expect(publicLoadFailureReason('x'.repeat(600))).toBe(`${'x'.repeat(500)}...`);
  });
});

describe('bundleHealth', () => {
  it('is healthy with the bundle id and version once a bundle is loaded', () => {
    expect(bundleHealth({ status: 'loaded', bundleId: 'acme:billing', bundleVersion: '1.2.0' })).toEqual({
      status: 'healthy',
      details: { state: 'loaded', bundleId: 'acme:billing', bundleVersion: '1.2.0' },
    });
  });

  const loaded = { status: 'loaded' as const, bundleId: 'acme:billing', bundleVersion: '1.2.0' };
  const at = '2026-11-05T08:00:00.000Z';

  it.each([
    ['applied', { status: 'applied' as const, bundleId: 'acme:billing', bundleVersion: '1.2.0', at }],
    ['was the bundle served', { status: 'unchanged' as const, bundleId: 'acme:billing', bundleVersion: '1.2.0', at }],
  ])('stays healthy when the last sync %s', (_label, lastSync) => {
    expect(bundleHealth(loaded, lastSync)).toEqual({
      status: 'healthy',
      details: { state: 'loaded', bundleId: 'acme:billing', bundleVersion: '1.2.0' },
    });
  });

  it.each([
    [
      'a refused newer bundle',
      { status: 'refused' as const, bundleId: 'acme:billing', bundleVersion: '1.3.0', reason: 'digest mismatch', at },
    ],
    ['a pull that failed', { status: 'failed' as const, reason: 'pull responded 503', cacheFallback: false, at }],
    [
      'the cached bundle served for a pull that failed',
      { status: 'failed' as const, reason: 'fetch failed', cacheFallback: true, at },
    ],
  ])('is degraded, still ready, and names the stale bundle served and %s', (_label, lastSync) => {
    expect(bundleHealth(loaded, lastSync)).toEqual({
      status: 'degraded',
      details: { state: 'stale', bundleId: 'acme:billing', bundleVersion: '1.2.0', lastSync },
    });
  });

  it('is unhealthy with the reason while loading failed', () => {
    expect(bundleHealth({ status: 'failed', reason: 'pull responded 401' })).toEqual({
      status: 'unhealthy',
      details: { state: 'failed' },
      error: 'no skill bundle is loaded: pull responded 401',
    });
  });

  it('is unhealthy while loading failed, whatever the last sync was', () => {
    const lastSync = { status: 'failed' as const, reason: 'pull responded 401', cacheFallback: false, at };

    expect(bundleHealth({ status: 'failed', reason: 'pull responded 401' }, lastSync)).toMatchObject({
      status: 'unhealthy',
      details: { state: 'failed' },
    });
  });

  it('is degraded while the first load has not finished', () => {
    expect(bundleHealth({ status: 'loading' })).toEqual({ status: 'degraded', details: { state: 'loading' } });
  });
});
