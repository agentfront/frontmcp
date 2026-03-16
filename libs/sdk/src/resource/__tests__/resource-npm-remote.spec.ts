import { Resource } from '../../common/decorators/resource.decorator';
import { ResourceKind } from '../../common/records/resource.record';
import type { ResourceEsmTargetRecord, ResourceRemoteRecord } from '../../common/records/resource.record';
import { normalizeResource, resourceDiscoveryDeps } from '../resource.utils';

describe('Resource.esm()', () => {
  it('creates ResourceEsmTargetRecord with kind ESM', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status') as ResourceEsmTargetRecord;
    expect(record.kind).toBe(ResourceKind.ESM);
  });

  it('parses scoped specifier correctly', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status') as ResourceEsmTargetRecord;
    expect(record.specifier.scope).toBe('@acme');
    expect(record.specifier.name).toBe('tools');
    expect(record.specifier.fullName).toBe('@acme/tools');
    expect(record.specifier.range).toBe('^1.0.0');
  });

  it('parses unscoped specifier correctly', () => {
    const record = Resource.esm('my-tools@latest', 'config') as ResourceEsmTargetRecord;
    expect(record.specifier.scope).toBeUndefined();
    expect(record.specifier.fullName).toBe('my-tools');
  });

  it('sets targetName', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status') as ResourceEsmTargetRecord;
    expect(record.targetName).toBe('status');
  });

  it('creates unique symbol provide token', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status') as ResourceEsmTargetRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('esm-resource:@acme/tools:status');
  });

  it('creates different symbols for different targets', () => {
    const r1 = Resource.esm('@acme/tools@^1.0.0', 'status') as ResourceEsmTargetRecord;
    const r2 = Resource.esm('@acme/tools@^1.0.0', 'config') as ResourceEsmTargetRecord;
    expect(r1.provide).not.toBe(r2.provide);
  });

  it('passes options through', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status', {
      loader: { url: 'https://custom.cdn' },
      cacheTTL: 60000,
    }) as ResourceEsmTargetRecord;
    expect(record.options?.loader).toEqual({ url: 'https://custom.cdn' });
    expect(record.options?.cacheTTL).toBe(60000);
  });

  it('generates placeholder metadata with uri', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status') as ResourceEsmTargetRecord;
    expect(record.metadata.name).toBe('status');
    expect(record.metadata.uri).toBe('esm://status');
    expect(record.metadata.description).toContain('status');
  });

  it('allows overriding metadata via options', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status', {
      metadata: { description: 'Custom desc', uri: 'custom://status' },
    }) as ResourceEsmTargetRecord;
    expect(record.metadata.description).toBe('Custom desc');
    expect(record.metadata.uri).toBe('custom://status');
    expect(record.metadata.name).toBe('status');
  });

  it('throws on empty specifier', () => {
    expect(() => Resource.esm('', 'status')).toThrow('Package specifier cannot be empty');
  });

  it('throws on invalid specifier', () => {
    expect(() => Resource.esm('!!!', 'status')).toThrow('Invalid package specifier');
  });
});

describe('Resource.remote()', () => {
  it('creates ResourceRemoteRecord with kind REMOTE', () => {
    const record = Resource.remote('https://api.example.com/mcp', 'config') as ResourceRemoteRecord;
    expect(record.kind).toBe(ResourceKind.REMOTE);
  });

  it('sets url and targetName', () => {
    const record = Resource.remote('https://api.example.com/mcp', 'config') as ResourceRemoteRecord;
    expect(record.url).toBe('https://api.example.com/mcp');
    expect(record.targetName).toBe('config');
  });

  it('creates unique symbol provide token', () => {
    const record = Resource.remote('https://api.example.com/mcp', 'config') as ResourceRemoteRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('remote-resource:https://api.example.com/mcp:config');
  });

  it('passes transportOptions and remoteAuth', () => {
    const record = Resource.remote('https://api.example.com/mcp', 'config', {
      transportOptions: { timeout: 30000 },
      remoteAuth: { mode: 'static', credentials: { type: 'bearer', value: 'tok' } },
    }) as ResourceRemoteRecord;
    expect(record.transportOptions).toEqual({ timeout: 30000 });
    expect(record.remoteAuth).toEqual({
      mode: 'static',
      credentials: { type: 'bearer', value: 'tok' },
    });
  });

  it('generates placeholder metadata with uri', () => {
    const record = Resource.remote('https://api.example.com/mcp', 'config') as ResourceRemoteRecord;
    expect(record.metadata.name).toBe('config');
    expect(record.metadata.uri).toBe('remote://config');
  });

  it('allows overriding metadata via options', () => {
    const record = Resource.remote('https://api.example.com/mcp', 'config', {
      metadata: { description: 'Custom remote resource' },
    }) as ResourceRemoteRecord;
    expect(record.metadata.description).toBe('Custom remote resource');
  });
});

describe('normalizeResource() with ESM/REMOTE records', () => {
  it('passes through ResourceEsmTargetRecord unchanged', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status') as ResourceEsmTargetRecord;
    const normalized = normalizeResource(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(ResourceKind.ESM);
  });

  it('passes through ResourceRemoteRecord unchanged', () => {
    const record = Resource.remote('https://api.example.com/mcp', 'config') as ResourceRemoteRecord;
    const normalized = normalizeResource(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(ResourceKind.REMOTE);
  });
});

describe('resourceDiscoveryDeps() with ESM/REMOTE records', () => {
  it('returns empty array for ESM record', () => {
    const record = Resource.esm('@acme/tools@^1.0.0', 'status') as ResourceEsmTargetRecord;
    expect(resourceDiscoveryDeps(record)).toEqual([]);
  });

  it('returns empty array for REMOTE record', () => {
    const record = Resource.remote('https://api.example.com/mcp', 'config') as ResourceRemoteRecord;
    expect(resourceDiscoveryDeps(record)).toEqual([]);
  });
});
