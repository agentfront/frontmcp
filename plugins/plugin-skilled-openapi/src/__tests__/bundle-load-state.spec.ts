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

  it('is unhealthy with the reason while loading failed', () => {
    expect(bundleHealth({ status: 'failed', reason: 'pull responded 401' })).toEqual({
      status: 'unhealthy',
      details: { state: 'failed' },
      error: 'no skill bundle is loaded: pull responded 401',
    });
  });

  it('is degraded while the first load has not finished', () => {
    expect(bundleHealth({ status: 'loading' })).toEqual({ status: 'degraded', details: { state: 'loading' } });
  });
});
