import { isAnonymousSubject } from '@frontmcp/sdk';

import { flowFailureOf, sessionTracingId } from '../plugin/observability.hooks';
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
  rawInput?: {
    request?: { method?: string; path?: string; body?: unknown; headers?: Record<string, unknown> };
    response?: { statusCode?: unknown };
  };
  state?: Record<string | symbol, unknown>;
}

interface VerifyResultLike {
  kind?: string;
  authorization?: { user?: { sub?: unknown } };
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

/** Records why an entry flow failed (its `state.flowError`) on the request's log, as the client sees it. */
export function recordRequestLogFailure(flowCtx: RequestLogFlowContext): void {
  const flowError = flowCtx.state?.['flowError'];
  if (!flowError) return;
  const { type, message, code, errorId } = flowFailureOf(flowError);
  currentRequestLog(flowCtx)?.setError({ type, message, code, error_id: errorId });
}

/**
 * Records how the HTTP flow authenticated the request (its `state.verifyResult`): `auth_type` is the scheme of
 * the `Authorization` header (`bearer`), or `anonymous` for a caller without one or with an anonymous subject.
 */
export function recordRequestLogAuth(flowCtx: RequestLogFlowContext): void {
  const verifyResult = flowCtx.state?.['verifyResult'] as VerifyResultLike | undefined;
  const authorization = flowCtx.rawInput?.request?.headers?.['authorization'];
  const scheme = typeof authorization === 'string' ? authorization.trim().split(/\s+/)[0].toLowerCase() : '';
  const sub = verifyResult?.authorization?.user?.sub;
  const anonymous = typeof sub !== 'string' || isAnonymousSubject(sub);
  currentRequestLog(flowCtx)?.setAuthInfo(
    anonymous || !scheme ? 'anonymous' : scheme,
    verifyResult?.kind === 'authorized' && !anonymous,
  );
}

/**
 * Closes the request's log with its HTTP status, which fires `requestLogs.onRequestComplete`: the status the
 * flow responded with (`state.statusCode`), else the one a transport wrote to the response itself. A status
 * of 400 or more marks the request failed.
 */
export async function completeRequestLog(flowCtx: RequestLogFlowContext): Promise<void> {
  const collector = currentRequestLog(flowCtx);
  if (!collector || collector.isFinalized()) return;
  const statusCode = flowCtx.state?.['statusCode'] ?? flowCtx.rawInput?.response?.statusCode;
  if (typeof statusCode === 'number') collector.setStatusCode(statusCode);
  await collector.finalize();
}
