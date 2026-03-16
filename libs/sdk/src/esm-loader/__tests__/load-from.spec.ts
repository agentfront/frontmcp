import { App } from '../../common/decorators/app.decorator';
import type { EsmAppOptions } from '../../common/metadata/app.metadata';

describe('App.esm()', () => {
  it('creates RemoteAppMetadata with urlType esm', () => {
    const result = App.esm('@acme/tools@^1.0.0');
    expect(result.urlType).toBe('esm');
    expect(result.url).toBe('@acme/tools@^1.0.0');
  });

  it('derives name from package specifier', () => {
    const result = App.esm('@acme/tools@^1.0.0');
    expect(result.name).toBe('@acme/tools');
  });

  it('derives name from unscoped package', () => {
    const result = App.esm('my-tools@latest');
    expect(result.name).toBe('my-tools');
  });

  it('allows overriding name via options', () => {
    const result = App.esm('@acme/tools@^1.0.0', { name: 'custom-name' });
    expect(result.name).toBe('custom-name');
  });

  it('sets namespace when provided', () => {
    const result = App.esm('@acme/tools@^1.0.0', { namespace: 'acme' });
    expect(result.namespace).toBe('acme');
  });

  it('sets description when provided', () => {
    const result = App.esm('@acme/tools@^1.0.0', { description: 'Acme tools' });
    expect(result.description).toBe('Acme tools');
  });

  it('defaults standalone to false', () => {
    const result = App.esm('@acme/tools@^1.0.0');
    expect(result.standalone).toBe(false);
  });

  it('allows standalone override', () => {
    const result = App.esm('@acme/tools@^1.0.0', { standalone: true });
    expect(result.standalone).toBe(true);
  });

  it('allows standalone "includeInParent"', () => {
    const result = App.esm('@acme/tools@^1.0.0', { standalone: 'includeInParent' });
    expect(result.standalone).toBe('includeInParent');
  });

  it('does not include packageConfig when no config options are set', () => {
    const result = App.esm('@acme/tools@^1.0.0', { namespace: 'acme' });
    expect(result.packageConfig).toBeUndefined();
  });

  it('includes packageConfig.loader when loader is provided', () => {
    const result = App.esm('@acme/tools@^1.0.0', {
      loader: { url: 'http://esm.internal.corp', token: 'xxx' },
    });
    expect(result.packageConfig?.loader).toEqual({
      url: 'http://esm.internal.corp',
      token: 'xxx',
    });
  });

  it('includes packageConfig.autoUpdate when autoUpdate is provided', () => {
    const result = App.esm('@acme/tools@^1.0.0', {
      autoUpdate: { enabled: true, intervalMs: 5000 },
    });
    expect(result.packageConfig?.autoUpdate).toEqual({
      enabled: true,
      intervalMs: 5000,
    });
  });

  it('includes packageConfig.cacheTTL when cacheTTL is provided', () => {
    const result = App.esm('@acme/tools@^1.0.0', { cacheTTL: 60000 });
    expect(result.packageConfig?.cacheTTL).toBe(60000);
  });

  it('includes packageConfig.importMap when importMap is provided', () => {
    const result = App.esm('@acme/tools@^1.0.0', {
      importMap: { lodash: 'https://esm.sh/lodash@4' },
    });
    expect(result.packageConfig?.importMap).toEqual({
      lodash: 'https://esm.sh/lodash@4',
    });
  });

  it('combines multiple packageConfig fields', () => {
    const opts: EsmAppOptions = {
      namespace: 'acme',
      loader: { url: 'http://custom.cdn' },
      autoUpdate: { enabled: true },
      cacheTTL: 30000,
      importMap: { react: 'https://esm.sh/react@18' },
    };
    const result = App.esm('@acme/tools@^1.0.0', opts);
    expect(result.packageConfig).toEqual({
      loader: { url: 'http://custom.cdn' },
      autoUpdate: { enabled: true },
      cacheTTL: 30000,
      importMap: { react: 'https://esm.sh/react@18' },
    });
  });

  it('passes filter config through', () => {
    const result = App.esm('@acme/tools@^1.0.0', {
      filter: { default: 'exclude', include: { tools: ['echo'] } },
    });
    expect(result.filter).toEqual({
      default: 'exclude',
      include: { tools: ['echo'] },
    });
  });

  it('throws on empty specifier', () => {
    expect(() => App.esm('')).toThrow('Package specifier cannot be empty');
  });

  it('throws on invalid specifier', () => {
    expect(() => App.esm('!!!invalid!!!')).toThrow('Invalid package specifier');
  });
});

describe('App.remote()', () => {
  it('creates RemoteAppMetadata with urlType url', () => {
    const result = App.remote('https://api.example.com/mcp');
    expect(result.urlType).toBe('url');
    expect(result.url).toBe('https://api.example.com/mcp');
  });

  it('derives name from hostname', () => {
    const result = App.remote('https://api.example.com/mcp');
    expect(result.name).toBe('api');
  });

  it('allows overriding name', () => {
    const result = App.remote('https://api.example.com/mcp', { name: 'my-api' });
    expect(result.name).toBe('my-api');
  });

  it('sets namespace when provided', () => {
    const result = App.remote('https://api.example.com/mcp', { namespace: 'api' });
    expect(result.namespace).toBe('api');
  });

  it('defaults standalone to false', () => {
    const result = App.remote('https://api.example.com/mcp');
    expect(result.standalone).toBe(false);
  });

  it('passes transport options through', () => {
    const result = App.remote('https://api.example.com/mcp', {
      transportOptions: { timeout: 60000, retryAttempts: 3 },
    });
    expect(result.transportOptions).toEqual({ timeout: 60000, retryAttempts: 3 });
  });

  it('passes remoteAuth through', () => {
    const result = App.remote('https://api.example.com/mcp', {
      remoteAuth: { mode: 'static', credentials: { type: 'bearer', value: 'token123' } },
    });
    expect(result.remoteAuth).toEqual({
      mode: 'static',
      credentials: { type: 'bearer', value: 'token123' },
    });
  });

  it('passes filter config through', () => {
    const result = App.remote('https://api.example.com/mcp', {
      filter: { exclude: { tools: ['dangerous-*'] } },
    });
    expect(result.filter).toEqual({ exclude: { tools: ['dangerous-*'] } });
  });

  it('rejects invalid URLs without a valid scheme', () => {
    expect(() => App.remote('not-a-url')).toThrow('URI must have a valid scheme');
  });
});
