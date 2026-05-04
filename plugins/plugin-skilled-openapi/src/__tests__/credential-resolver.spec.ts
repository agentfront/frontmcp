import { MemoryCredentialResolver } from '../executor/credential-resolver';

describe('MemoryCredentialResolver', () => {
  it('returns undefined for unknown refs', async () => {
    const r = new MemoryCredentialResolver();
    expect(await r.resolve('unknown', { bundleId: 'b' })).toBeUndefined();
  });

  it('resolves tenant-wide defaults', async () => {
    const r = new MemoryCredentialResolver({ stripeKey: 'sk_live_abc' });
    expect(await r.resolve('stripeKey', { bundleId: 'any' })).toBe('sk_live_abc');
  });

  it('strips a single trailing newline at ingestion (handles file-sourced secrets)', async () => {
    const r = new MemoryCredentialResolver({ k: 'value\n' });
    expect(await r.resolve('k', { bundleId: 'b' })).toBe('value');
  });

  it('strips a trailing CRLF', async () => {
    const r = new MemoryCredentialResolver({ k: 'value\r\n' });
    expect(await r.resolve('k', { bundleId: 'b' })).toBe('value');
  });

  it('does not strip internal whitespace', async () => {
    const r = new MemoryCredentialResolver({ k: 'a\nb' });
    expect(await r.resolve('k', { bundleId: 'b' })).toBe('a\nb');
  });

  it('per-bundle override wins over tenant default', async () => {
    const r = new MemoryCredentialResolver({ apiKey: 'tenant' });
    r.setForBundle('bundle-a', 'apiKey', 'override-a');
    expect(await r.resolve('apiKey', { bundleId: 'bundle-a' })).toBe('override-a');
    // Other bundles still see the tenant default.
    expect(await r.resolve('apiKey', { bundleId: 'bundle-b' })).toBe('tenant');
  });

  it('per-bundle entries can be set without any tenant defaults', async () => {
    const r = new MemoryCredentialResolver();
    r.setForBundle('b', 'k', 'v\n');
    expect(await r.resolve('k', { bundleId: 'b' })).toBe('v');
    expect(await r.resolve('k', { bundleId: 'other' })).toBeUndefined();
  });

  it('setForBundle can update an existing per-bundle entry', async () => {
    const r = new MemoryCredentialResolver();
    r.setForBundle('b', 'k', 'first');
    r.setForBundle('b', 'k', 'second');
    expect(await r.resolve('k', { bundleId: 'b' })).toBe('second');
  });
});
