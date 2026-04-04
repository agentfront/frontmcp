/**
 * RPC Span — follows OTel RPC semantic conventions for MCP.
 *
 * MCP is treated as its own RPC system (`rpc.system = "mcp"`)
 * rather than generic JSON-RPC, following the FastMCP convention
 * for better filtering in trace backends.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { RpcAttributes, McpAttributes, FrontMcpAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface RpcSpanOptions {
  /** MCP method (e.g., "tools/call", "resources/read") */
  method: string;

  /** JSON-RPC request ID */
  requestId?: string | number;

  /** Scope ID */
  scopeId?: string;

  /** Server/service name */
  serviceName?: string;

  /** Hashed session ID for trace correlation */
  sessionIdHash?: string;

  /** Parent OTel context */
  parentContext?: Context;
}

/**
 * Start an RPC span for an MCP method invocation.
 *
 * Span name follows OTel convention: "{rpc.method}"
 */
export function startRpcSpan(tracer: Tracer, options: RpcSpanOptions): { span: Span; context: Context } {
  const attributes: Record<string, string | number | boolean> = {
    [RpcAttributes.SYSTEM]: 'mcp',
    [RpcAttributes.METHOD]: options.method,
    [RpcAttributes.JSONRPC_VERSION]: '2.0',
    [McpAttributes.METHOD_NAME]: options.method,
  };

  if (options.requestId !== undefined) {
    attributes[RpcAttributes.JSONRPC_REQUEST_ID] = String(options.requestId);
  }
  if (options.scopeId) {
    attributes[FrontMcpAttributes.SCOPE_ID] = options.scopeId;
  }
  if (options.serviceName) {
    attributes[RpcAttributes.SERVICE] = options.serviceName;
    attributes[FrontMcpAttributes.SERVER_NAME] = options.serviceName;
  }
  if (options.sessionIdHash) {
    attributes[McpAttributes.SESSION_ID] = options.sessionIdHash;
    attributes[FrontMcpAttributes.SESSION_ID_HASH] = options.sessionIdHash;
  }

  return startSpan(tracer, {
    name: options.method,
    kind: SpanKind.SERVER,
    attributes,
    parentContext: options.parentContext,
  });
}
