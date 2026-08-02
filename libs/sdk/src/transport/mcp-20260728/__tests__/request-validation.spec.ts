import { MCP_20260728_ERROR_CODES, MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { encodeHeaderValue } from '../header-codec';
import {
  collectHeaderParams,
  isProtocol20260728Request,
  readHeader,
  validate20260728Request,
} from '../request-validation';

const META = {
  [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
  [MCP_20260728_META.clientCapabilities]: {},
};

function request(method: string, params: Record<string, unknown> = {}, id: unknown = 1) {
  return { jsonrpc: '2.0', id, method, params: { ...params, _meta: META } } as Record<string, unknown>;
}

function headers(extra: Record<string, string> = {}) {
  return {
    'mcp-protocol-version': PROTOCOL_2026_07_28,
    ...extra,
  } as Record<string, unknown>;
}

describe('readHeader', () => {
  it('reads case-insensitively', () => {
    expect(readHeader({ 'MCP-Method': 'tools/list' }, 'mcp-method')).toBe('tools/list');
  });

  it('takes the first entry of an array-valued header', () => {
    expect(readHeader({ 'mcp-method': ['tools/list', 'other'] }, 'mcp-method')).toBe('tools/list');
  });

  it('returns undefined when absent', () => {
    expect(readHeader({}, 'mcp-method')).toBeUndefined();
    expect(readHeader(undefined, 'mcp-method')).toBeUndefined();
  });
});

describe('isProtocol20260728Request', () => {
  it('claims a request declaring the version in _meta', () => {
    expect(isProtocol20260728Request({ headers: {}, body: request('tools/list') })).toBe(true);
  });

  it('claims a request whose header names an unknown version', () => {
    // Otherwise a future version would fall into the session pipeline and get a
    // confusing "send initialize first" instead of a proper -32022.
    expect(
      isProtocol20260728Request({ headers: { 'mcp-protocol-version': '2099-01-01' }, body: { method: 'tools/list' } }),
    ).toBe(true);
  });

  it('claims 2026-only methods', () => {
    expect(isProtocol20260728Request({ headers: {}, body: { method: 'server/discover' } })).toBe(true);
    expect(isProtocol20260728Request({ headers: {}, body: { method: 'subscriptions/listen' } })).toBe(true);
  });

  it('does NOT claim legacy revisions', () => {
    for (const version of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']) {
      expect(
        isProtocol20260728Request({
          headers: { 'mcp-protocol-version': version },
          body: { method: 'tools/list', params: {} },
        }),
      ).toBe(false);
    }
  });

  it('does NOT claim a bare legacy initialize', () => {
    expect(isProtocol20260728Request({ headers: {}, body: { method: 'initialize', params: {} } })).toBe(false);
  });
});

describe('validate20260728Request', () => {
  it('accepts a fully conforming request', () => {
    const result = validate20260728Request({
      headers: headers({ 'mcp-method': 'tools/list' }),
      body: request('tools/list'),
    });
    expect(result).toEqual({ ok: true, version: PROTOCOL_2026_07_28 });
  });

  it('rejects a missing protocol version header', () => {
    const result = validate20260728Request({ headers: { 'mcp-method': 'tools/list' }, body: request('tools/list') });
    expect(result).toMatchObject({ ok: false, status: 400, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });
  });

  it('rejects a body missing the _meta protocol version', () => {
    const result = validate20260728Request({
      headers: headers({ 'mcp-method': 'tools/list' }),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: {} } },
    });
    expect(result).toMatchObject({ ok: false, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });
    expect((result as { error: { message: string } }).error.message).toContain(MCP_20260728_META.protocolVersion);
  });

  it('rejects a header/body version disagreement', () => {
    const result = validate20260728Request({
      headers: { 'mcp-protocol-version': '2025-06-18', 'mcp-method': 'tools/list' },
      body: request('tools/list'),
    });
    expect(result).toMatchObject({ ok: false, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });
  });

  it('reports an unsupported version with the supported list', () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: { [MCP_20260728_META.protocolVersion]: '2099-01-01' } },
    };
    const result = validate20260728Request({
      headers: { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' },
      body,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: {
        code: MCP_20260728_ERROR_CODES.unsupportedProtocolVersion,
        data: { requested: '2099-01-01' },
      },
    });
    expect((result as { error: { data: { supported: string[] } } }).error.data.supported).toContain(
      PROTOCOL_2026_07_28,
    );
  });

  it('rejects a missing Mcp-Method header', () => {
    const result = validate20260728Request({ headers: headers(), body: request('tools/list') });
    expect(result).toMatchObject({ ok: false, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });
  });

  it('rejects an Mcp-Method that disagrees with the body', () => {
    const result = validate20260728Request({
      headers: headers({ 'mcp-method': 'resources/list' }),
      body: request('tools/list'),
    });
    expect(result).toMatchObject({ ok: false, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });
  });

  it('validates Mcp-Name against params.name for tools/call', () => {
    const body = request('tools/call', { name: 'echo', arguments: {} });

    expect(
      validate20260728Request({ headers: headers({ 'mcp-method': 'tools/call', 'mcp-name': 'echo' }), body }),
    ).toMatchObject({ ok: true });

    expect(
      validate20260728Request({ headers: headers({ 'mcp-method': 'tools/call', 'mcp-name': 'other' }), body }),
    ).toMatchObject({ ok: false, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });

    expect(validate20260728Request({ headers: headers({ 'mcp-method': 'tools/call' }), body })).toMatchObject({
      ok: false,
      error: { code: MCP_20260728_ERROR_CODES.headerMismatch },
    });
  });

  it('validates Mcp-Name against params.uri for resources/read', () => {
    const body = request('resources/read', { uri: 'proto://config' });
    expect(
      validate20260728Request({
        headers: headers({ 'mcp-method': 'resources/read', 'mcp-name': 'proto://config' }),
        body,
      }),
    ).toMatchObject({ ok: true });
  });

  it('decodes a sentinel-encoded Mcp-Name before comparing', () => {
    const body = request('tools/call', { name: 'Hello, 世界', arguments: {} });
    expect(
      validate20260728Request({
        headers: headers({ 'mcp-method': 'tools/call', 'mcp-name': encodeHeaderValue('Hello, 世界') }),
        body,
      }),
    ).toMatchObject({ ok: true });
  });

  it('skips body validation for notifications', () => {
    // The revision leaves notification header requirements undefined, so only
    // the version header is enforced.
    const result = validate20260728Request({
      headers: headers({ 'mcp-method': 'notifications/cancelled' }),
      body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('rejects a body with no method', () => {
    const result = validate20260728Request({ headers: headers(), body: { jsonrpc: '2.0', id: 1 } });
    expect(result).toMatchObject({ ok: false, error: { code: -32600 } });
  });

  describe('x-mcp-header parameters', () => {
    const schema = {
      type: 'object',
      properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' },
        query: { type: 'string' },
      },
    };
    const lookupToolSchema = () => schema;

    const call = (args: Record<string, unknown>) => request('tools/call', { name: 'q', arguments: args });
    const base = { 'mcp-method': 'tools/call', 'mcp-name': 'q' };

    it('accepts a matching header', () => {
      expect(
        validate20260728Request({
          headers: headers({ ...base, 'mcp-param-region': 'us-west1' }),
          body: call({ region: 'us-west1', query: 'x' }),
          lookupToolSchema,
        }),
      ).toMatchObject({ ok: true });
    });

    it('rejects a mismatched header', () => {
      expect(
        validate20260728Request({
          headers: headers({ ...base, 'mcp-param-region': 'eu-central1' }),
          body: call({ region: 'us-west1', query: 'x' }),
          lookupToolSchema,
        }),
      ).toMatchObject({ ok: false, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });
    });

    it('rejects a client that omits the header for a present argument', () => {
      expect(
        validate20260728Request({
          headers: headers(base),
          body: call({ region: 'us-west1', query: 'x' }),
          lookupToolSchema,
        }),
      ).toMatchObject({ ok: false, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });
    });

    it('expects no header when the argument is absent', () => {
      expect(
        validate20260728Request({ headers: headers(base), body: call({ query: 'x' }), lookupToolSchema }),
      ).toMatchObject({ ok: true });
    });

    it('rejects a header sent for an absent argument', () => {
      expect(
        validate20260728Request({
          headers: headers({ ...base, 'mcp-param-region': 'us-west1' }),
          body: call({ query: 'x' }),
          lookupToolSchema,
        }),
      ).toMatchObject({ ok: false, error: { code: MCP_20260728_ERROR_CODES.headerMismatch } });
    });

    it('skips validation when the tool is unknown', () => {
      expect(
        validate20260728Request({
          headers: headers(base),
          body: call({ region: 'us-west1' }),
          lookupToolSchema: () => null,
        }),
      ).toMatchObject({ ok: true });
    });
  });
});

describe('collectHeaderParams', () => {
  it('collects annotations on top-level properties', () => {
    const found = collectHeaderParams({
      type: 'object',
      properties: { region: { type: 'string', 'x-mcp-header': 'Region' } },
    });
    expect(found.get('region')).toEqual(['region']);
  });

  it('collects annotations on nested properties reachable through `properties` only', () => {
    const found = collectHeaderParams({
      type: 'object',
      properties: {
        target: {
          type: 'object',
          properties: { zone: { type: 'string', 'x-mcp-header': 'Zone' } },
        },
      },
    });
    expect(found.get('zone')).toEqual(['target', 'zone']);
  });

  it('ignores annotations behind array items', () => {
    // `items` is not a statically reachable chain, so the annotation is invalid
    // and must not produce a header expectation.
    const found = collectHeaderParams({
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'object', properties: { x: { 'x-mcp-header': 'X' } } } },
      },
    });
    expect(found.size).toBe(0);
  });

  it('returns empty for a schema with no properties', () => {
    expect(collectHeaderParams({ type: 'string' }).size).toBe(0);
    expect(collectHeaderParams(null).size).toBe(0);
  });
});
