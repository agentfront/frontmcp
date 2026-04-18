/**
 * Translate thrown FrontMCP errors into MCP SDK `McpError` instances so the
 * transport layer emits the correct JSON-RPC code (e.g. -32602, -32601)
 * instead of the default -32603.
 *
 * Errors that already expose a `toJsonRpcError()` method (e.g. TaskNotFoundError)
 * are converted verbatim. Everything else falls through unchanged.
 *
 * @module transport/mcp-handlers/mcp-error.utils
 */

import { McpError } from '@modelcontextprotocol/sdk/types.js';

export function toSdkMcpError(err: unknown): Error {
  if (err && typeof err === 'object') {
    const jsonRpc = (err as { toJsonRpcError?: () => { code: number; message: string; data?: unknown } })
      .toJsonRpcError;
    if (typeof jsonRpc === 'function') {
      const j = jsonRpc.call(err);
      return new McpError(j.code, j.message, j.data);
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}
