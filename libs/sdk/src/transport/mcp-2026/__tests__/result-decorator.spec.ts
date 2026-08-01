import { MCP_2026_META } from '@frontmcp/protocol';

import { DEFAULT_CACHE_TTL_MS } from '../protocol-2026.constants';
import { decorateResult, resolveCacheScope } from '../result-decorator';

const serverInfo = { name: 'test-server', version: '1.0.0' };

describe('decorateResult', () => {
  it('marks an ordinary result complete', () => {
    const out = decorateResult({ tools: [] }, { method: 'tools/list', serverInfo });
    expect(out['resultType']).toBe('complete');
  });

  it('preserves an interim resultType', () => {
    // The MRTR path sets `input_required` itself; overwriting it would collapse
    // the round trip into a bogus final result.
    const out = decorateResult({ resultType: 'input_required' }, { method: 'tools/call', serverInfo });
    expect(out['resultType']).toBe('input_required');
  });

  it('attaches serverInfo to _meta', () => {
    const out = decorateResult({}, { method: 'tools/list', serverInfo });
    expect((out['_meta'] as Record<string, unknown>)[MCP_2026_META.serverInfo]).toEqual(serverInfo);
  });

  it('preserves existing _meta entries', () => {
    const out = decorateResult({ _meta: { custom: 'value' } }, { method: 'tools/list', serverInfo });
    expect(out['_meta']).toMatchObject({ custom: 'value' });
  });

  it('adds ttlMs and cacheScope to cacheable methods', () => {
    for (const method of Object.keys(DEFAULT_CACHE_TTL_MS)) {
      const out = decorateResult({}, { method, serverInfo, cacheScope: 'public' });
      expect(out['ttlMs']).toBe(DEFAULT_CACHE_TTL_MS[method]);
      expect(out['cacheScope']).toBe('public');
    }
  });

  it('leaves non-cacheable methods alone', () => {
    const out = decorateResult({ content: [] }, { method: 'tools/call', serverInfo });
    expect(out['ttlMs']).toBeUndefined();
    expect(out['cacheScope']).toBeUndefined();
  });

  it('honours an explicit ttl override', () => {
    const out = decorateResult({}, { method: 'tools/list', serverInfo, ttlMs: 1234 });
    expect(out['ttlMs']).toBe(1234);
  });

  it('defaults cacheScope to private', () => {
    // Defaulting to `public` would let a shared proxy serve one tenant's list
    // to another, so the safe value is the default.
    const out = decorateResult({}, { method: 'tools/list', serverInfo });
    expect(out['cacheScope']).toBe('private');
  });
});

describe('resolveCacheScope', () => {
  it('marks anonymous traffic public', () => {
    expect(resolveCacheScope(true)).toBe('public');
  });

  it('marks authenticated traffic private', () => {
    expect(resolveCacheScope(false)).toBe('private');
  });
});
