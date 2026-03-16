import { Tool } from '../../common/decorators/tool.decorator';
import { ToolKind } from '../../common/records/tool.record';
import type { ToolEsmTargetRecord, ToolRemoteRecord } from '../../common/records/tool.record';
import { normalizeTool, toolDiscoveryDeps } from '../tool.utils';

describe('Tool.esm()', () => {
  it('creates ToolEsmTargetRecord with kind ESM', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo') as ToolEsmTargetRecord;
    expect(record.kind).toBe(ToolKind.ESM);
  });

  it('parses scoped specifier correctly', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo') as ToolEsmTargetRecord;
    expect(record.specifier.scope).toBe('@acme');
    expect(record.specifier.name).toBe('tools');
    expect(record.specifier.fullName).toBe('@acme/tools');
    expect(record.specifier.range).toBe('^1.0.0');
  });

  it('parses unscoped specifier correctly', () => {
    const record = (Tool as any).esm('my-tools@latest', 'echo') as ToolEsmTargetRecord;
    expect(record.specifier.scope).toBeUndefined();
    expect(record.specifier.name).toBe('my-tools');
    expect(record.specifier.fullName).toBe('my-tools');
    expect(record.specifier.range).toBe('latest');
  });

  it('parses specifier without version range', () => {
    const record = (Tool as any).esm('my-tools', 'echo') as ToolEsmTargetRecord;
    expect(record.specifier.range).toBe('latest');
  });

  it('sets targetName', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo') as ToolEsmTargetRecord;
    expect(record.targetName).toBe('echo');
  });

  it('creates unique symbol provide token', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo') as ToolEsmTargetRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('esm-tool:@acme/tools:echo');
  });

  it('creates different symbols for different targets', () => {
    const r1 = (Tool as any).esm('@acme/tools@^1.0.0', 'echo') as ToolEsmTargetRecord;
    const r2 = (Tool as any).esm('@acme/tools@^1.0.0', 'add') as ToolEsmTargetRecord;
    expect(r1.provide).not.toBe(r2.provide);
  });

  it('passes options through (loader, cacheTTL)', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo', {
      loader: { url: 'https://custom.cdn' },
      cacheTTL: 60000,
    }) as ToolEsmTargetRecord;
    expect(record.options?.loader).toEqual({ url: 'https://custom.cdn' });
    expect(record.options?.cacheTTL).toBe(60000);
  });

  it('generates placeholder metadata', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo') as ToolEsmTargetRecord;
    expect(record.metadata.name).toBe('echo');
    expect(record.metadata.description).toContain('echo');
    expect(record.metadata.description).toContain('@acme/tools');
    expect(record.metadata.inputSchema).toEqual({});
  });

  it('allows overriding metadata via options', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo', {
      metadata: { description: 'Custom description', name: 'custom-echo' },
    }) as ToolEsmTargetRecord;
    expect(record.metadata.description).toBe('Custom description');
    expect(record.metadata.name).toBe('custom-echo');
  });

  it('merges partial metadata with defaults', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo', {
      metadata: { description: 'Override only description' },
    }) as ToolEsmTargetRecord;
    expect(record.metadata.description).toBe('Override only description');
    expect(record.metadata.inputSchema).toEqual({});
  });

  it('throws on empty specifier', () => {
    expect(() => (Tool as any).esm('', 'echo')).toThrow('Package specifier cannot be empty');
  });

  it('throws on invalid specifier', () => {
    expect(() => (Tool as any).esm('!!!invalid!!!', 'echo')).toThrow('Invalid package specifier');
  });
});

describe('Tool.remote()', () => {
  it('creates ToolRemoteRecord with kind REMOTE', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search') as ToolRemoteRecord;
    expect(record.kind).toBe(ToolKind.REMOTE);
  });

  it('sets url and targetName', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search') as ToolRemoteRecord;
    expect(record.url).toBe('https://api.example.com/mcp');
    expect(record.targetName).toBe('search');
  });

  it('creates unique symbol provide token', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search') as ToolRemoteRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('remote-tool:https://api.example.com/mcp:search');
  });

  it('passes transportOptions', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search', {
      transportOptions: { timeout: 30000, retryAttempts: 3 },
    }) as ToolRemoteRecord;
    expect(record.transportOptions).toEqual({ timeout: 30000, retryAttempts: 3 });
  });

  it('passes remoteAuth', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search', {
      remoteAuth: { mode: 'static', credentials: { type: 'bearer', value: 'tok' } },
    }) as ToolRemoteRecord;
    expect(record.remoteAuth).toEqual({
      mode: 'static',
      credentials: { type: 'bearer', value: 'tok' },
    });
  });

  it('generates placeholder metadata', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search') as ToolRemoteRecord;
    expect(record.metadata.name).toBe('search');
    expect(record.metadata.description).toContain('search');
    expect(record.metadata.description).toContain('https://api.example.com/mcp');
  });

  it('allows overriding metadata via options', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search', {
      metadata: { description: 'Custom remote desc' },
    }) as ToolRemoteRecord;
    expect(record.metadata.description).toBe('Custom remote desc');
    expect(record.metadata.name).toBe('search');
  });
});

describe('normalizeTool() with ESM/REMOTE records', () => {
  it('passes through ToolEsmTargetRecord unchanged', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo') as ToolEsmTargetRecord;
    const normalized = normalizeTool(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(ToolKind.ESM);
  });

  it('passes through ToolRemoteRecord unchanged', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search') as ToolRemoteRecord;
    const normalized = normalizeTool(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(ToolKind.REMOTE);
  });
});

describe('toolDiscoveryDeps() with ESM/REMOTE records', () => {
  it('returns empty array for ESM record', () => {
    const record = (Tool as any).esm('@acme/tools@^1.0.0', 'echo') as ToolEsmTargetRecord;
    expect(toolDiscoveryDeps(record)).toEqual([]);
  });

  it('returns empty array for REMOTE record', () => {
    const record = (Tool as any).remote('https://api.example.com/mcp', 'search') as ToolRemoteRecord;
    expect(toolDiscoveryDeps(record)).toEqual([]);
  });
});
