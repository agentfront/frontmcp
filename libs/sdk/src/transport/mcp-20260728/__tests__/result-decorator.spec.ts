import { MCP_20260728_META } from '@frontmcp/protocol';

import { DEFAULT_CACHE_TTL_MS } from '../protocol-20260728.constants';
import { decorateResult, orderListResult, resolveCacheScope } from '../result-decorator';

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
    expect((out['_meta'] as Record<string, unknown>)[MCP_20260728_META.serverInfo]).toEqual(serverInfo);
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

describe('orderListResult', () => {
  it('sorts tools by name', () => {
    const out = orderListResult('tools/list', { tools: [{ name: 'b' }, { name: 'a' }, { name: 'c' }] });
    expect((out['tools'] as Array<{ name: string }>).map((t) => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts prompts, resources and templates', () => {
    expect(orderListResult('prompts/list', { prompts: [{ name: 'z' }, { name: 'a' }] })['prompts']).toEqual([
      { name: 'a' },
      { name: 'z' },
    ]);
    expect(orderListResult('resources/list', { resources: [{ uri: 'b://x' }, { uri: 'a://x' }] })['resources']).toEqual(
      [{ uri: 'a://x' }, { uri: 'b://x' }],
    );
    expect(
      orderListResult('resources/templates/list', { resourceTemplates: [{ name: 'y' }, { name: 'x' }] })[
        'resourceTemplates'
      ],
    ).toEqual([{ name: 'x' }, { name: 'y' }]);
  });

  it('falls back to uri when an entry has no name', () => {
    const out = orderListResult('resources/list', { resources: [{ uri: 'b://x' }, { name: 'a' }] });
    expect(out['resources']).toEqual([{ name: 'a' }, { uri: 'b://x' }]);
  });

  it('leaves non-list methods untouched', () => {
    const input = {
      content: [
        { type: 'text', text: 'z' },
        { type: 'text', text: 'a' },
      ],
    };
    expect(orderListResult('tools/call', input)).toBe(input);
  });

  it('leaves a malformed list untouched', () => {
    const input = { tools: 'not-an-array' };
    expect(orderListResult('tools/list', input)).toBe(input);
  });

  it('does not mutate the input', () => {
    const input = { tools: [{ name: 'b' }, { name: 'a' }] };
    orderListResult('tools/list', input);
    expect(input.tools.map((t) => t.name)).toEqual(['b', 'a']);
  });
});
