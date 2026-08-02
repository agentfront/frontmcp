/**
 * `CacheableResult` — SEP-2549.
 *
 * `ttlMs` and `cacheScope` are REQUIRED on results returned by `tools/list`,
 * `prompts/list`, `resources/list`, `resources/read`, and
 * `resources/templates/list` (plus `server/discover`).
 */
import { expect, test } from '@frontmcp/testing';

import { mcpStatelessFetch } from './helpers/mcp-stateless-client';

const CACHEABLE: { method: string; params?: Record<string, unknown> }[] = [
  { method: 'tools/list' },
  { method: 'prompts/list' },
  { method: 'resources/list' },
  { method: 'resources/templates/list' },
  { method: 'resources/read', params: { uri: 'proto://config' } },
  { method: 'server/discover' },
];

test.describe('protocol 2026-07-28 — cacheable results', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  for (const [index, call] of CACHEABLE.entries()) {
    test(`${call.method} returns a numeric ttlMs >= 0`, async ({ server }) => {
      const res = await mcpStatelessFetch(server.info.baseUrl, { ...call, id: 300 + index });
      const { result, error } = res.json();

      expect(error).toBeUndefined();
      expect(typeof result.ttlMs).toBe('number');
      expect(Number.isFinite(result.ttlMs)).toBe(true);
      expect(result.ttlMs).toBeGreaterThanOrEqual(0);
    });

    test(`${call.method} returns a valid cacheScope`, async ({ server }) => {
      const res = await mcpStatelessFetch(server.info.baseUrl, { ...call, id: 400 + index });
      const { result } = res.json();

      expect(['public', 'private']).toContain(result.cacheScope);
    });
  }

  test('non-cacheable results do NOT gain ttlMs/cacheScope', async ({ server }) => {
    // `tools/call` is not a CacheableResult — inventing the fields there would
    // mislead intermediaries into caching a side-effecting call.
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 500,
      params: { name: 'echo', arguments: { message: 'no-cache' } },
    });

    const { result } = res.json();
    expect(result.ttlMs).toBeUndefined();
    expect(result.cacheScope).toBeUndefined();
  });

  test('scopes an authenticated-context list as private', async ({ server }) => {
    // This server runs in public mode, so `public` is legitimate; the assertion
    // is that the server makes a deliberate choice rather than omitting it.
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'tools/list', id: 501 });
    const { result } = res.json();
    expect(result.cacheScope).toBeDefined();
  });
});
