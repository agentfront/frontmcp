/**
 * `server/discover` — SEP-2575.
 *
 * Servers MUST implement this RPC to advertise supported protocol versions,
 * capabilities, and identity. It replaces `initialize` as the (optional)
 * up-front negotiation step.
 */
import { expect, test } from '@frontmcp/testing';

import { mcpStatelessFetch, META_SERVER_INFO, PROTOCOL_20260728 } from './helpers/mcp-stateless-client';

test.describe('protocol 2026-07-28 — server/discover', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('responds to server/discover without any prior handshake', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'server/discover', id: 1 });

    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.error).toBeUndefined();
    expect(body.id).toBe(1);
    expect(body.jsonrpc).toBe('2.0');
  });

  test('advertises 2026-07-28 among supportedVersions', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'server/discover', id: 2 });
    const { result } = res.json();

    expect(Array.isArray(result.supportedVersions)).toBe(true);
    expect(result.supportedVersions).toContain(PROTOCOL_20260728);
  });

  test('still advertises the legacy versions it supports', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'server/discover', id: 3 });
    const { result } = res.json();

    // Backwards compatibility is a hard requirement: dropping the older
    // revisions from `supportedVersions` would strand every existing client.
    expect(result.supportedVersions).toContain('2025-06-18');
    expect(result.supportedVersions).toContain('2025-03-26');
  });

  test('returns server capabilities and instructions', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'server/discover', id: 4 });
    const { result } = res.json();

    expect(result.capabilities).toBeDefined();
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.resources).toBeDefined();
    expect(result.capabilities.prompts).toBeDefined();
  });

  test('carries resultType "complete" and serverInfo in _meta', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'server/discover', id: 5 });
    const { result } = res.json();

    expect(result.resultType).toBe('complete');
    expect(result._meta?.[META_SERVER_INFO]).toMatchObject({
      name: expect.any(String),
      version: expect.any(String),
    });
  });

  test('is cacheable — carries ttlMs and cacheScope', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'server/discover', id: 6 });
    const { result } = res.json();

    expect(typeof result.ttlMs).toBe('number');
    expect(result.ttlMs).toBeGreaterThanOrEqual(0);
    expect(['public', 'private']).toContain(result.cacheScope);
  });

  test('declares the extensions field on capabilities', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'server/discover', id: 7 });
    const { result } = res.json();

    // `extensions` was added to ServerCapabilities in 2026-07-28; keys must be
    // prefixed identifiers per the `_meta` naming rules.
    expect(result.capabilities.extensions).toBeDefined();
    for (const key of Object.keys(result.capabilities.extensions ?? {})) {
      expect(key).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+\/.+$/i);
    }
  });
});
