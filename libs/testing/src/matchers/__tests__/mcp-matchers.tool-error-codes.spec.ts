import { McpTestClient } from '../../client/mcp-test-client';
import type { ToolResultWrapper } from '../../client/mcp-test-client.types';
import { mcpMatchers } from '../mcp-matchers';
import type {} from '../matcher-types';

expect.extend(mcpMatchers);

const BASE_URL = 'http://localhost:3006';

const invalidInputToolResult = {
  content: [{ type: 'text', text: 'Invalid input: validation failed' }],
  isError: true,
  _meta: { errorId: 'err_0123456789abcdef', code: 'INVALID_INPUT', timestamp: '2026-01-01T00:00:00.000Z' },
};

function stubServerReturningToolError(): void {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const message = JSON.parse(String(init?.body)) as { id?: number; method?: string };
    if (message.method === 'initialize') {
      const result = {
        protocolVersion: '2025-06-18',
        capabilities: {},
        serverInfo: { name: 'test', version: '1.0.0' },
      };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (message.method === 'tools/call') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: invalidInputToolResult }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: 202 });
  }) as typeof fetch;
}

async function callToolWithMissingInput(): Promise<ToolResultWrapper> {
  stubServerReturningToolError();
  const mcp = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();
  await mcp.connect();
  return mcp.tools.call('add', { a: 5 });
}

describe('toBeError with tool error codes', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('passes for an isError tool result whose _meta.code equals the expected code', async () => {
    const result = await callToolWithMissingInput();

    expect(result.isError).toBe(true);
    expect(result).toBeError('INVALID_INPUT');
  });

  it('names the received _meta.code when the expected code differs', async () => {
    const result = await callToolWithMissingInput();

    expect(() => expect(result).toBeError('NOT_FOUND')).toThrow(/INVALID_INPUT/);
  });

  it('still matches a numeric JSON-RPC code against the error code', async () => {
    const result = await callToolWithMissingInput();

    expect(() => expect(result).toBeError(-32602)).toThrow(/Expected error code -32602, but got undefined/);
  });
});
