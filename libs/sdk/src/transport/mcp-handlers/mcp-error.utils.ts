/**
 * Translate thrown FrontMCP errors into protocol-level `McpError` instances so
 * the transport layer emits the correct JSON-RPC code (e.g. -32602, -32601)
 * instead of the default -32603.
 *
 * Errors that already expose a `toJsonRpcError()` method (e.g. TaskNotFoundError)
 * are converted verbatim. Everything else falls through unchanged.
 *
 * Imports go through `@frontmcp/protocol` so we can later drop the direct
 * dependency on the upstream MCP SDK package without touching call sites.
 *
 * @module transport/mcp-handlers/mcp-error.utils
 */

import { McpError } from '@frontmcp/protocol';

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
