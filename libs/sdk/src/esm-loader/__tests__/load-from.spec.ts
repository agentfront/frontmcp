import { loadFrom } from '../load-from';
import type { LoadFromOptions } from '../load-from';

describe('loadFrom()', () => {
  it('creates RemoteAppMetadata with urlType npm', () => {
    const result = loadFrom('@acme/tools@^1.0.0');
    expect(result.urlType).toBe('npm');
    expect(result.url).toBe('@acme/tools@^1.0.0');
  });

  it('derives name from package specifier', () => {
    const result = loadFrom('@acme/tools@^1.0.0');
    expect(result.name).toBe('@acme/tools');
  });

  it('derives name from unscoped package', () => {
    const result = loadFrom('my-tools@latest');
    expect(result.name).toBe('my-tools');
  });

  it('allows overriding name via options', () => {
    const result = loadFrom('@acme/tools@^1.0.0', { name: 'custom-name' });
    expect(result.name).toBe('custom-name');
  });

  it('sets namespace when provided', () => {
    const result = loadFrom('@acme/tools@^1.0.0', { namespace: 'acme' });
    expect(result.namespace).toBe('acme');
  });

  it('sets description when provided', () => {
    const result = loadFrom('@acme/tools@^1.0.0', { description: 'Acme tools' });
    expect(result.description).toBe('Acme tools');
  });

  it('defaults standalone to false', () => {
    const result = loadFrom('@acme/tools@^1.0.0');
    expect(result.standalone).toBe(false);
  });

  it('allows standalone override', () => {
    const result = loadFrom('@acme/tools@^1.0.0', { standalone: true });
    expect(result.standalone).toBe(true);
  });

  it('allows standalone "includeInParent"', () => {
    const result = loadFrom('@acme/tools@^1.0.0', { standalone: 'includeInParent' });
    expect(result.standalone).toBe('includeInParent');
  });

  it('does not include packageConfig when no config options are set', () => {
    const result = loadFrom('@acme/tools@^1.0.0', { namespace: 'acme' });
    expect(result.packageConfig).toBeUndefined();
  });

  it('includes packageConfig.loader when loader is provided', () => {
    const result = loadFrom('@acme/tools@^1.0.0', {
      loader: { url: 'http://esm.internal.corp', token: 'xxx' },
    });
    expect(result.packageConfig?.loader).toEqual({
      url: 'http://esm.internal.corp',
      token: 'xxx',
    });
  });

  it('includes packageConfig.autoUpdate when autoUpdate is provided', () => {
    const result = loadFrom('@acme/tools@^1.0.0', {
      autoUpdate: { enabled: true, intervalMs: 5000 },
    });
    expect(result.packageConfig?.autoUpdate).toEqual({
      enabled: true,
      intervalMs: 5000,
    });
  });

  it('includes packageConfig.cacheTTL when cacheTTL is provided', () => {
    const result = loadFrom('@acme/tools@^1.0.0', { cacheTTL: 60000 });
    expect(result.packageConfig?.cacheTTL).toBe(60000);
  });

  it('includes packageConfig.importMap when importMap is provided', () => {
    const result = loadFrom('@acme/tools@^1.0.0', {
      importMap: { lodash: 'https://esm.sh/lodash@4' },
    });
    expect(result.packageConfig?.importMap).toEqual({
      lodash: 'https://esm.sh/lodash@4',
    });
  });

  it('combines multiple packageConfig fields', () => {
    const opts: LoadFromOptions = {
      namespace: 'acme',
      loader: { url: 'http://custom.cdn' },
      autoUpdate: { enabled: true },
      cacheTTL: 30000,
      importMap: { react: 'https://esm.sh/react@18' },
    };
    const result = loadFrom('@acme/tools@^1.0.0', opts);
    expect(result.packageConfig).toEqual({
      loader: { url: 'http://custom.cdn' },
      autoUpdate: { enabled: true },
      cacheTTL: 30000,
      importMap: { react: 'https://esm.sh/react@18' },
    });
  });

  it('throws on empty specifier', () => {
    expect(() => loadFrom('')).toThrow('Package specifier cannot be empty');
  });

  it('throws on invalid specifier', () => {
    expect(() => loadFrom('!!!invalid!!!')).toThrow('Invalid package specifier');
  });
});
