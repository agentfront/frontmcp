/**
 * Standard request headers — SEP-2243.
 *
 * Streamable HTTP mirrors selected body fields into headers so intermediaries
 * can route without parsing the body. The server MUST validate that the two
 * agree and reject mismatches with `400` + `-32020` (HeaderMismatch).
 */
import { expect, test } from '@frontmcp/testing';

import {
  encodeHeaderValue,
  HEADER_MISMATCH,
  mcpStatelessFetch,
  META_PROTOCOL_VERSION,
  PROTOCOL_20260728,
  UNSUPPORTED_PROTOCOL_VERSION,
  type ListedTool,
} from './helpers/mcp-stateless-client';

test.describe('protocol 2026-07-28 — request metadata headers', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('accepts a request whose headers match the body', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 1,
      params: { name: 'echo', arguments: { message: 'ok' } },
    });

    expect(res.status).toBe(200);
    expect(res.json().error).toBeUndefined();
  });

  test('rejects a missing Mcp-Method header with -32020', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 2,
      headers: { 'mcp-method': null },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(HEADER_MISMATCH);
  });

  test('rejects an Mcp-Method that disagrees with the body', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 3,
      headers: { 'mcp-method': 'resources/list' },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(HEADER_MISMATCH);
  });

  test('rejects a missing Mcp-Name on tools/call', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 4,
      params: { name: 'echo', arguments: {} },
      headers: { 'mcp-name': null },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(HEADER_MISMATCH);
  });

  test('rejects an Mcp-Name that disagrees with params.name', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 5,
      params: { name: 'echo', arguments: {} },
      headers: { 'mcp-name': 'region-query' },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(HEADER_MISMATCH);
  });

  test('validates Mcp-Name against params.uri for resources/read', async ({ server }) => {
    const ok = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'resources/read',
      id: 6,
      params: { uri: 'proto://config' },
    });
    expect(ok.status).toBe(200);
    expect(ok.json().error).toBeUndefined();

    const bad = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'resources/read',
      id: 7,
      params: { uri: 'proto://config' },
      headers: { 'mcp-name': 'proto://something-else' },
    });
    expect(bad.status).toBe(400);
    expect(bad.json().error.code).toBe(HEADER_MISMATCH);
  });

  test('decodes the =?base64?…?= sentinel before comparing Mcp-Name', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'resources/read',
      id: 8,
      params: { uri: 'proto://config' },
      headers: { 'mcp-name': encodeHeaderValue('=?base64?proto://config?=') },
    });

    // The header decodes to a value that does NOT match the body, so this must
    // be rejected — proving the server decodes rather than string-compares.
    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(HEADER_MISMATCH);

    const good = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'resources/read',
      id: 9,
      params: { uri: 'proto://config' },
      headers: { 'mcp-name': `=?base64?${Buffer.from('proto://config', 'utf8').toString('base64')}?=` },
    });
    expect(good.status).toBe(200);
    expect(good.json().error).toBeUndefined();
  });

  test('rejects a missing MCP-Protocol-Version header', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 10,
      headers: { 'mcp-protocol-version': null },
    });

    // Body `_meta` says 2026-07-28 but the header is absent. Under 2026-07-28
    // the header is REQUIRED, so this is a header-validation failure.
    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(HEADER_MISMATCH);
  });

  test('rejects a MCP-Protocol-Version header that disagrees with _meta', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 11,
      headers: { 'mcp-protocol-version': '2025-06-18' },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(HEADER_MISMATCH);
  });

  test('rejects an unknown protocol version with -32022 and lists supported', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 12,
      protocolVersion: '2099-01-01',
    });

    expect(res.status).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe(UNSUPPORTED_PROTOCOL_VERSION);
    expect(error.data.requested).toBe('2099-01-01');
    expect(Array.isArray(error.data.supported)).toBe(true);
    expect(error.data.supported).toContain(PROTOCOL_20260728);
  });

  test('accepts a matching Mcp-Param-* header from x-mcp-header', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 13,
      params: { name: 'region-query', arguments: { region: 'us-west1', query: 'SELECT 1' } },
      headers: { 'mcp-param-region': 'us-west1' },
    });

    expect(res.status).toBe(200);
    const { result } = res.json();
    expect(JSON.stringify(result.content ?? result.structuredContent)).toContain('us-west1');
  });

  test('rejects an Mcp-Param-* header that disagrees with the argument', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/call',
      id: 14,
      params: { name: 'region-query', arguments: { region: 'us-west1', query: 'SELECT 1' } },
      headers: { 'mcp-param-region': 'eu-central1' },
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe(HEADER_MISMATCH);
  });

  test('advertises x-mcp-header in the tool inputSchema', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'tools/list', id: 15 });
    const tool = (res.json().result.tools as ListedTool[]).find((t) => t.name === 'region-query');

    expect(tool?.inputSchema?.['properties']?.region?.['x-mcp-header']).toBe('Region');
  });

  test('treats header names case-insensitively', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 16,
      headers: { 'mcp-method': null, 'MCP-METHOD': 'tools/list' },
    });

    expect(res.status).toBe(200);
    expect(res.json().error).toBeUndefined();
  });

  test('rejects when _meta protocolVersion is absent entirely', async ({ server }) => {
    const { baseUrl } = server.info;
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_20260728,
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/list',
        params: { _meta: {} },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(HEADER_MISMATCH);
    expect(String(body.error.message)).toContain(META_PROTOCOL_VERSION);
  });
});
