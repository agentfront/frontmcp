/**
 * Translate thrown FrontMCP errors into protocol-level `McpError` instances so
 * the transport layer emits the correct JSON-RPC code (e.g. -32602, -32601)
 * instead of the default -32603.
 *
 * Errors that already expose a `toJsonRpcError()` method (e.g. TaskNotFoundError)
 * are converted verbatim. Other public errors keep their message and get a code
 * from their HTTP status; internal errors are masked in production.
 *
 * Imports go through `@frontmcp/protocol` so we can later drop the direct
 * dependency on the upstream MCP SDK package without touching call sites.
 *
 * @module transport/mcp-handlers/mcp-error.utils
 */

import { McpError } from '@frontmcp/protocol';
import { isProduction } from '@frontmcp/utils';

import { FlowControl } from '../../common';
import { InternalMcpError, MCP_ERROR_CODES, toMcpError } from '../../errors';

type JsonRpcErrorSource = { toJsonRpcError: () => { code: number; message: string; data?: unknown } };

function hasJsonRpcError(err: unknown): err is JsonRpcErrorSource {
  return typeof (err as Partial<JsonRpcErrorSource> | null)?.toJsonRpcError === 'function';
}

function jsonRpcCodeForStatus(statusCode: number): number {
  if (statusCode === 401) return MCP_ERROR_CODES.UNAUTHORIZED;
  if (statusCode === 403) return MCP_ERROR_CODES.FORBIDDEN;
  return statusCode < 500 ? MCP_ERROR_CODES.INVALID_PARAMS : MCP_ERROR_CODES.INTERNAL_ERROR;
}

/**
 * The error a failed flow stands for: the one passed to `this.fail()`, or an
 * internal error for any other early exit. Other errors are returned as they are.
 */
export function errorBehindFlowControl(err: unknown): unknown {
  if (!(err instanceof FlowControl)) return err;
  const original = (err as { originalError?: unknown }).originalError;
  if (err.type === 'fail' && original !== undefined) return original;
  return new InternalMcpError(`Flow ended with: ${err.type}`);
}

/**
 * The error a failed request answers with, as a FrontMCP error where it isn't
 * already one with a JSON-RPC shape. Log this one, then pass it to
 * `toSdkMcpError`, so the logged error id is the one the client sees.
 */
export function toReportedError(err: unknown): unknown {
  const failure = errorBehindFlowControl(err);
  return failure instanceof McpError || hasJsonRpcError(failure) ? failure : toMcpError(failure);
}

export function toSdkMcpError(err: unknown): McpError {
  const failure = errorBehindFlowControl(err);
  if (failure instanceof McpError) return failure;
  if (hasJsonRpcError(failure)) {
    const jsonRpc = failure.toJsonRpcError();
    return new McpError(jsonRpc.code, jsonRpc.message, jsonRpc.data);
  }

  const error = toMcpError(failure);
  const data = { errorId: error.errorId, code: error.code };
  if (error.isPublic) {
    return new McpError(jsonRpcCodeForStatus(error.statusCode), error.getPublicMessage(), data);
  }
  const message = isProduction() ? error.getPublicMessage() : error.message;
  return new McpError(MCP_ERROR_CODES.INTERNAL_ERROR, message, data);
}
