/**
 * JSON-RPC dispatch for protocol 2026-07-28.
 *
 * Reuses the SAME `createMcpHandlers` set every other transport uses, so tools,
 * resources, prompts and completions behave identically across revisions —
 * only the envelope differs. What this layer adds is the 2026-specific
 * behaviour: method admission (removed methods now 404), the MRTR exchange,
 * and result decoration.
 */
import { MCP_2026_ERROR_CODES, MCP_2026_REMOVED_METHODS, McpError, type Implementation } from '@frontmcp/protocol';

import { type FrontMcpContext } from '../../context';
import { InputRequiredSignal, MissingClientCapabilityError } from '../../errors';
import { type Scope } from '../../scope';
import { buildScopedServerOptions } from '../build-scoped-server-options';
import { createMcpHandlers } from '../mcp-handlers';
import { buildDiscoverResult } from './discover';
import { buildInputRequiredResult, decodeRequestState, MrtrExchange } from './mrtr';
import { type JsonRpcErrorPayload } from './request-validation';
import { decorateResult, resolveCacheScope } from './result-decorator';

export interface DispatchOptions {
  scope: Scope;
  /** The validated JSON-RPC request body. */
  body: Record<string, unknown>;
  /** Capabilities the client declared in this request's `_meta`. */
  clientCapabilities: Record<string, unknown>;
  /** Ambient request context, used to carry the MRTR exchange to `elicit()`. */
  frontmcpContext?: FrontMcpContext;
  /** Auth info forwarded to the shared handlers. */
  authInfo?: Record<string, unknown>;
  /** True when the caller is unauthenticated, which makes results publicly cacheable. */
  isAnonymous: boolean;
  signal?: AbortSignal;
  /** Lazily composed instructions for `server/discover`. */
  composeInstructions?: () => string | undefined;
}

export type DispatchResult =
  | { kind: 'result'; result: Record<string, unknown> }
  | { kind: 'error'; status: number; error: JsonRpcErrorPayload };

/** Read the JSON-RPC method literal a handler's request schema is bound to. */
function methodOfSchema(schema: unknown): string | undefined {
  const shape = (schema as { shape?: Record<string, unknown> } | undefined)?.shape;
  const method = shape?.['method'] as { value?: unknown; _def?: { values?: unknown[] } } | undefined;
  if (typeof method?.value === 'string') return method.value;
  const values = method?._def?.values;
  return Array.isArray(values) && typeof values[0] === 'string' ? values[0] : undefined;
}

/**
 * Map a thrown error onto a JSON-RPC error payload.
 *
 * The one substantive change from earlier revisions is resource-not-found:
 * `-32002` was retired in favour of `-32602` to align with JSON-RPC. Because
 * the shared handlers still raise the old code (they serve legacy clients too),
 * the translation happens here rather than at the source.
 */
export function toJsonRpcError(error: unknown): { status: number; error: JsonRpcErrorPayload } {
  if (error instanceof MissingClientCapabilityError) {
    return {
      status: 400,
      error: {
        code: MCP_2026_ERROR_CODES.missingRequiredClientCapability,
        message: error.getPublicMessage(),
        data: { requiredCapabilities: error.requiredCapabilities },
      },
    };
  }

  const withJsonRpc = error as { toJsonRpcError?: () => JsonRpcErrorPayload } | undefined;
  let payload: JsonRpcErrorPayload;

  if (typeof withJsonRpc?.toJsonRpcError === 'function') {
    payload = withJsonRpc.toJsonRpcError();
  } else if (error instanceof McpError) {
    payload = { code: error.code, message: error.message, data: (error as { data?: unknown }).data };
  } else {
    payload = { code: -32603, message: error instanceof Error ? error.message : String(error) };
  }

  // Retired in 2026-07-28: resource-not-found is now Invalid Params.
  if (payload.code === -32002) payload = { ...payload, code: -32602 };

  return { status: 200, error: payload };
}

/**
 * Dispatch one 2026-07-28 JSON-RPC request.
 *
 * `subscriptions/listen` is NOT handled here — it needs to own the HTTP
 * response as a stream, so the flow handles it before calling in.
 */
export async function dispatch2026(options: DispatchOptions): Promise<DispatchResult> {
  const { scope, body, clientCapabilities, frontmcpContext, authInfo, isAnonymous, signal, composeInstructions } =
    options;

  const method = body['method'] as string;
  const params = (body['params'] as Record<string, unknown> | undefined) ?? {};
  const cacheScope = resolveCacheScope(isAnonymous);
  const serverInfo = scope.metadata.info as Implementation;

  if ((MCP_2026_REMOVED_METHODS as readonly string[]).includes(method)) {
    return {
      kind: 'error',
      status: 404,
      error: { code: -32601, message: `Method not found: ${method} was removed in protocol 2026-07-28` },
    };
  }

  if (method === 'server/discover') {
    return {
      kind: 'result',
      result: decorateResult(buildDiscoverResult(scope, composeInstructions?.()) as Record<string, unknown>, {
        method,
        serverInfo,
        cacheScope,
      }),
    };
  }

  const serverOptions = buildScopedServerOptions(scope, composeInstructions?.() ?? '');
  const handlers = createMcpHandlers({ scope, serverOptions, composeInstructions });

  const handler = handlers.find((entry) => methodOfSchema(entry.requestSchema) === method);
  if (!handler) {
    return { kind: 'error', status: 404, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  // Every request carries its own MRTR exchange: capabilities are per-request in
  // this revision, so an exchange must never outlive the request that made it.
  const exchange = new MrtrExchange({
    inputResponses: params['inputResponses'] as Record<string, Record<string, unknown>> | undefined,
    carriedResponses: decodeRequestState(params['requestState']),
    clientCapabilities,
  });
  frontmcpContext?.setMrtrExchange(exchange);

  const ctx = {
    signal: signal ?? new AbortController().signal,
    requestId: body['id'] as string | number,
    authInfo,
    sendNotification: async () => undefined,
    sendRequest: async () => {
      // 2026-07-28 removed the server→client request direction outright. A
      // handler reaching for it is a bug, not a transport limitation.
      throw new McpError(-32603, 'Server-initiated requests were removed in protocol 2026-07-28; use MRTR');
    },
  };

  try {
    const raw = (await handler.handler(body as never, ctx as never)) as Record<string, unknown>;
    return { kind: 'result', result: decorateResult(raw, { method, serverInfo, cacheScope }) };
  } catch (error) {
    if (error instanceof InputRequiredSignal) {
      return {
        kind: 'result',
        result: decorateResult(buildInputRequiredResult(error), { method, serverInfo, cacheScope }),
      };
    }
    const mapped = toJsonRpcError(error);
    return { kind: 'error', status: mapped.status, error: mapped.error };
  }
}
