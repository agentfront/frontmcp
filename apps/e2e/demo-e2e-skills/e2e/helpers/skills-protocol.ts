/**
 * Shared test helpers for skills MCP protocol methods.
 *
 * Provides typed wrappers for skills/search, skills/load, and skills/list
 * JSON-RPC methods used across E2E tests.
 */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface McpRawClient {
  raw: { request: (msg: JsonRpcRequest) => Promise<JsonRpcResponse> };
}

let nextId = 1;

/**
 * Reset the request ID counter (for test isolation).
 */
export function resetRequestId(): void {
  nextId = 1;
}

/**
 * Search for skills via the skills/search MCP protocol method.
 */
export async function searchSkills(
  mcp: McpRawClient,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await mcp.raw.request({
    jsonrpc: '2.0' as const,
    id: nextId++,
    method: 'skills/search',
    params,
  });
  if (response.error) {
    throw new Error(`skills/search error: ${response.error.message}`);
  }
  return response.result ?? {};
}

/**
 * Load skills via the skills/load MCP protocol method.
 */
export async function loadSkills(mcp: McpRawClient, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await mcp.raw.request({
    jsonrpc: '2.0' as const,
    id: nextId++,
    method: 'skills/load',
    params,
  });
  if (response.error) {
    throw new Error(`skills/load error: ${response.error.message}`);
  }
  return response.result ?? {};
}

/**
 * List skills via the skills/list MCP protocol method.
 */
export async function listSkills(
  mcp: McpRawClient,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await mcp.raw.request({
    jsonrpc: '2.0' as const,
    id: nextId++,
    method: 'skills/list',
    params: params ?? {},
  });
  if (response.error) {
    throw new Error(`skills/list error: ${response.error.message}`);
  }
  return response.result ?? {};
}
