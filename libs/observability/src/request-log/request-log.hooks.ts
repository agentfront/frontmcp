import { sessionTracingId } from '../plugin/observability.hooks';
import { RequestLogCollector } from './request-log.collector';
import { REQUEST_LOG_COLLECTOR } from './request-log.tokens';
import type { RequestLogCollectorOptions } from './request-log.types';

const FRONTMCP_CONTEXT = Symbol.for('frontmcp:CONTEXT');

interface RequestContextStore {
  requestId: string;
  sessionId: string;
  scopeId: string;
  traceContext: { traceId: string };
  get(key: symbol): unknown;
  set(key: symbol, value: unknown): void;
}

interface RequestLogFlowContext {
  get?(token: unknown): unknown;
  rawInput?: { request?: { method?: string; path?: string; body?: unknown }; response?: { statusCode?: unknown } };
  state?: Record<string | symbol, unknown>;
}

function resolve<T>(flowCtx: RequestLogFlowContext, token: symbol): T | undefined {
  try {
    return flowCtx.get?.(token) as T | undefined;
  } catch {
    return undefined;
  }
}

/** The open request log of the request `flowCtx` serves; entry flows annotate it. */
export function currentRequestLog(flowCtx: RequestLogFlowContext): RequestLogCollector | undefined {
  return resolve<RequestContextStore>(flowCtx, FRONTMCP_CONTEXT)?.get(REQUEST_LOG_COLLECTOR) as
    | RequestLogCollector
    | undefined;
}

/** Opens the request's log, kept on the request context so the entry flows and log entries reach it. */
export function startRequestLog(flowCtx: RequestLogFlowContext, options: RequestLogCollectorOptions): void {
  const context = resolve<RequestContextStore>(flowCtx, FRONTMCP_CONTEXT);
  if (!context) return;
  const collector = new RequestLogCollector(
    {
      requestId: context.requestId,
      traceId: context.traceContext.traceId,
      sessionIdHash: sessionTracingId(context.sessionId).slice(0, 12),
      scopeId: context.scopeId,
    },
    options,
  );
  context.set(REQUEST_LOG_COLLECTOR, collector);
  const request = flowCtx.rawInput?.request;
  if (request?.method && request.path) collector.setHttpInfo(request.method, request.path);
  const rpcMethod = (request?.body as { method?: unknown } | undefined)?.method;
  if (typeof rpcMethod === 'string') collector.setRpcMethod(rpcMethod);
}

/** Records why an entry flow failed (its `state.flowError`) on the request's log. */
export function recordRequestLogFailure(flowCtx: RequestLogFlowContext): void {
  const failure = flowCtx.state?.['flowError'];
  if (!failure) return;
  const error = failure instanceof Error ? failure : new Error(String(failure));
  currentRequestLog(flowCtx)?.setError({
    type: error.name,
    message: error.message,
    code: (error as { code?: string }).code,
  });
}

/**
 * Closes the request's log with its HTTP status, which fires `requestLogs.onRequestComplete`: the status the
 * flow responded with (`state.statusCode`), else the one a transport wrote to the response itself.
 */
export async function completeRequestLog(flowCtx: RequestLogFlowContext): Promise<void> {
  const collector = currentRequestLog(flowCtx);
  if (!collector || collector.isFinalized()) return;
  const statusCode = flowCtx.state?.['statusCode'] ?? flowCtx.rawInput?.response?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400) collector.setStatus('error', statusCode);
  await collector.finalize();
}
