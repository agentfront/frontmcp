/**
 * ObservabilityHooks — comprehensive auto-instrumentation for FrontMCP.
 *
 * Provides full-depth visibility across the ENTIRE FrontMCP system:
 * - HTTP request flow (every stage: traceRequest → auth → route → transport → finalize)
 * - Tool/Resource/Prompt/Agent execution (every flow stage as span events)
 * - Auth flows (verify, session, OAuth token/authorize/callback)
 * - Skill flows (search, load, HTTP endpoints)
 * - Elicitation flows (request, result)
 * - External fetch calls
 * - Session lifecycle
 * - Plugin initialization
 *
 * Architecture:
 * - Single trace ID per request (from FrontMcpContext.traceContext)
 * - Session tracing ID = truncated SHA-256 hash (not the real session ID)
 * - Root span per flow type (HTTP, RPC, execution)
 * - Every flow stage recorded as a timed span event
 * - Error status propagated to parent spans
 */

import { sha256Hex } from '@frontmcp/utils';
import {
  type Tracer,
  type Span,
  type Context as OTelContext,
  SpanKind,
  SpanStatusCode,
  trace,
  context as otelContext,
} from '@opentelemetry/api';

import { createOTelContextFromTrace, type TraceContextLike } from '../otel/trace-context-bridge';
import { startHttpServerSpan, setHttpResponseStatus } from '../otel/spans/http-server.span';
import { startRpcSpan } from '../otel/spans/rpc.span';
import { startToolSpan } from '../otel/spans/tool.span';
import { startResourceSpan } from '../otel/spans/resource.span';
import { startPromptSpan } from '../otel/spans/prompt.span';
import { startSpan, endSpanOk, endSpanError } from '../otel/spans/span.utils';
import { FrontMcpAttributes, McpAttributes, EnduserAttributes, HttpAttributes } from '../otel/otel.types';
import type { TracingOptions } from '../otel/otel.types';

// ─────────────────────────────────────────────────────────────────────────────
// Span storage keys (symbols to avoid user-state collision)
// ─────────────────────────────────────────────────────────────────────────────

/** Root span for the current flow (HTTP server span or RPC span) */
export const SPAN_KEY = Symbol.for('frontmcp:otel:span');
/** OTel context containing the root span (for child span parenting) */
export const SPAN_CTX_KEY = Symbol.for('frontmcp:otel:span-ctx');
/** Execution span (tool/resource/prompt/agent child span) */
export const EXEC_SPAN_KEY = Symbol.for('frontmcp:otel:exec-span');
/** Active telemetry span — stored on FrontMcpContext.set() so TelemetryAccessor can read it */
export const ACTIVE_SPAN_KEY = Symbol.for('frontmcp:otel:active-span');
/** Active OTel context for child span parenting from TelemetryAccessor */
export const ACTIVE_OTEL_CTX_KEY = Symbol.for('frontmcp:otel:active-otel-ctx');
/** Timestamp of the last recorded stage event */
export const STAGE_TS_KEY = Symbol.for('frontmcp:otel:stage-ts');

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a privacy-safe session tracing ID.
 * 16-char truncated SHA-256 — sufficient for trace correlation,
 * not reversible to the original session ID.
 */
export function sessionTracingId(sessionId: string): string {
  return sha256Hex(sessionId).slice(0, 16);
}

function getTracer(): Tracer {
  return trace.getTracer('@frontmcp/observability');
}

/** Minimal context shape to avoid tight coupling to FrontMcpContext. */
interface FlowRequestContext {
  requestId: string;
  sessionId: string;
  scopeId: string;
  traceContext: TraceContextLike;
  authInfo?: {
    clientId?: string;
    scopes?: string[];
    extra?: Record<string, unknown>;
  };
  metadata?: {
    customHeaders?: Record<string, string>;
  };
}

/** Try to extract FrontMcpContext from a flow context. */
function extractContext(flowCtx: any): FlowRequestContext | undefined {
  try {
    const ctx = flowCtx.get?.(Symbol.for('frontmcp:CONTEXT'));
    if (ctx) return ctx;
  } catch {
    /* ignore */
  }
  return flowCtx.state?.ctx ?? flowCtx.state?.frontmcpContext;
}

/**
 * Store the active execution span on the FrontMcpContext so that
 * TelemetryAccessor can read it for addEvent/setAttributes.
 *
 * The context.set/get store is the correct place because it's
 * per-request and available to CONTEXT-scoped providers.
 */
function storeActiveSpan(flowCtx: any, span: Span, otelCtx: OTelContext): void {
  try {
    const ctx = flowCtx.get?.(Symbol.for('frontmcp:CONTEXT'));
    if (ctx && typeof ctx.set === 'function') {
      ctx.set(ACTIVE_SPAN_KEY, span);
      ctx.set(ACTIVE_OTEL_CTX_KEY, otelCtx);
    }
  } catch {
    /* ignore */
  }
}

function clearActiveSpan(flowCtx: any): void {
  try {
    const ctx = flowCtx.get?.(Symbol.for('frontmcp:CONTEXT'));
    if (ctx && typeof ctx.delete === 'function') {
      ctx.delete(ACTIVE_SPAN_KEY);
      ctx.delete(ACTIVE_OTEL_CTX_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** Record a timed stage event on a span, showing stage duration. */
function recordStageEvent(span: Span, stageName: string, state: any): void {
  const now = Date.now();
  const prev = state[STAGE_TS_KEY] as number | undefined;
  const attributes: Record<string, string | number> = {};
  if (prev) {
    attributes['duration_ms'] = now - prev;
  }
  state[STAGE_TS_KEY] = now;
  span.addEvent(`stage.${stageName}`, attributes);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Request Flow — scope:http-request
// Stages: traceRequest → acquireQuota → acquireSemaphore → checkAuthorization →
//         router → handle* → audit → metrics → release* → finalize
// ─────────────────────────────────────────────────────────────────────────────

export function onHttpWillTrace(options: TracingOptions, flowCtx: any): void {
  if (options.httpSpans === false) return;
  const ctx = extractContext(flowCtx);
  if (!ctx) return;

  const tracer = getTracer();
  const parentOTelCtx = createOTelContextFromTrace(ctx.traceContext);
  const sessionHash = sessionTracingId(ctx.sessionId);

  const { span, context: spanCtx } = startHttpServerSpan(tracer, {
    method: ctx.metadata?.customHeaders?.['x-http-method'] ?? 'POST',
    path: ctx.metadata?.customHeaders?.['x-url-path'] ?? '/mcp',
    scopeId: ctx.scopeId,
    requestId: ctx.requestId,
    parentContext: parentOTelCtx,
  });

  span.setAttribute(McpAttributes.SESSION_ID, sessionHash);
  span.setAttribute(FrontMcpAttributes.SESSION_ID_HASH, sessionHash);

  flowCtx.state[SPAN_KEY] = span;
  flowCtx.state[SPAN_CTX_KEY] = spanCtx;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(span, 'traceRequest', flowCtx.state);
}

export function onHttpWillAcquireQuota(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'acquireQuota', flowCtx.state);
}

export function onHttpDidAcquireQuota(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'acquireQuota.done', flowCtx.state);
}

export function onHttpWillCheckAuth(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'checkAuthorization', flowCtx.state);
}

export function onHttpDidCheckAuth(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'checkAuthorization.done', flowCtx.state);
}

export function onHttpWillRoute(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'router', flowCtx.state);
}

export function onHttpDidRoute(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'router.done', flowCtx.state);
}

export function onHttpDidFinalize(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (!span) return;

  recordStageEvent(span, 'finalize', flowCtx.state);

  const statusCode = flowCtx.state?.statusCode ?? 200;
  setHttpResponseStatus(span, statusCode);

  if (statusCode >= 400) {
    endSpanError(span, `HTTP ${statusCode}`);
  } else {
    endSpanOk(span);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Call Flow — tools:call-tool
// Stages: parseInput → ensureRemoteCapabilities → findTool →
//         checkToolAuthorization → createToolCallContext → acquireQuota →
//         acquireSemaphore → validateInput → execute → validateOutput →
//         releaseSemaphore → releaseQuota → applyUI → finalize
// ─────────────────────────────────────────────────────────────────────────────

export function onToolWillParse(options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;
  const ctx = extractContext(flowCtx);
  if (!ctx) return;

  const tracer = getTracer();
  const parentOTelCtx = createOTelContextFromTrace(ctx.traceContext);
  const sessionHash = sessionTracingId(ctx.sessionId);

  const { span, context: spanCtx } = startRpcSpan(tracer, {
    method: 'tools/call',
    scopeId: ctx.scopeId,
    sessionIdHash: sessionHash,
    parentContext: parentOTelCtx,
  });

  flowCtx.state[SPAN_KEY] = span;
  flowCtx.state[SPAN_CTX_KEY] = spanCtx;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(span, 'parseInput', flowCtx.state);
}

export function onToolWillFindTool(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'findTool', flowCtx.state);
}

export function onToolWillCheckAuth(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'checkToolAuthorization', flowCtx.state);
}

export function onToolWillCreateContext(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'createToolCallContext', flowCtx.state);
}

export function onToolWillValidateInput(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'validateInput', flowCtx.state);
}

export function onToolWillExecute(options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;

  const ctx = extractContext(flowCtx);
  const rpcCtx: OTelContext | undefined = flowCtx.state?.[SPAN_CTX_KEY];
  const tracer = getTracer();

  const toolName = flowCtx.state?.input?.name ?? 'unknown';
  const toolOwner = flowCtx.state?._toolOwnerId;
  const enduser = ctx?.authInfo;

  const { span: toolSpan, context: toolOTelCtx } = startToolSpan(tracer, {
    name: toolName,
    owner: toolOwner,
    enduserId: enduser?.clientId ?? (enduser?.extra?.sub as string | undefined),
    enduserScope: Array.isArray(enduser?.scopes) ? enduser.scopes.join(' ') : undefined,
    parentContext: rpcCtx,
  });

  flowCtx.state[EXEC_SPAN_KEY] = toolSpan;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(toolSpan, 'execute.start', flowCtx.state);

  // Store on FrontMcpContext so TelemetryAccessor.addEvent/setAttributes
  // target the correct parent span
  storeActiveSpan(flowCtx, toolSpan, toolOTelCtx);
}

export function onToolDidExecute(options: TracingOptions, flowCtx: any): void {
  const toolSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  if (!toolSpan) return;
  recordStageEvent(toolSpan, 'execute.done', flowCtx.state);
  endSpanOk(toolSpan);
  flowCtx.state[EXEC_SPAN_KEY] = undefined;
  clearActiveSpan(flowCtx);
}

export function onToolWillValidateOutput(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'validateOutput', flowCtx.state);
}

export function onToolWillApplyUI(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'applyUI', flowCtx.state);
}

export function onToolDidFinalize(flowCtx: any): void {
  const rpcSpan: Span | undefined = flowCtx.state?.[SPAN_KEY];
  const toolSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  const error = flowCtx.state?.error;

  if (error) {
    if (toolSpan) endSpanError(toolSpan, error instanceof Error ? error : String(error));
    if (rpcSpan) endSpanError(rpcSpan, error instanceof Error ? error : String(error));
  } else if (rpcSpan) {
    recordStageEvent(rpcSpan, 'finalize', flowCtx.state);
    endSpanOk(rpcSpan);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Read Flow — resources:read-resource
// Stages: parseInput → ensureRemoteCapabilities → findResource →
//         createResourceContext → execute → validateOutput → finalize
// ─────────────────────────────────────────────────────────────────────────────

export function onResourceWillParse(options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;
  const ctx = extractContext(flowCtx);
  if (!ctx) return;

  const tracer = getTracer();
  const parentOTelCtx = createOTelContextFromTrace(ctx.traceContext);
  const sessionHash = sessionTracingId(ctx.sessionId);

  const { span, context: spanCtx } = startRpcSpan(tracer, {
    method: 'resources/read',
    scopeId: ctx.scopeId,
    sessionIdHash: sessionHash,
    parentContext: parentOTelCtx,
  });

  flowCtx.state[SPAN_KEY] = span;
  flowCtx.state[SPAN_CTX_KEY] = spanCtx;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(span, 'parseInput', flowCtx.state);
}

export function onResourceWillFind(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'findResource', flowCtx.state);
}

export function onResourceWillExecute(options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;
  const rpcCtx: OTelContext | undefined = flowCtx.state?.[SPAN_CTX_KEY];
  const tracer = getTracer();
  const uri = flowCtx.state?.input?.uri ?? 'unknown';

  const { span: resSpan, context: resOTelCtx } = startResourceSpan(tracer, { uri, parentContext: rpcCtx });
  flowCtx.state[EXEC_SPAN_KEY] = resSpan;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(resSpan, 'execute.start', flowCtx.state);
  storeActiveSpan(flowCtx, resSpan, resOTelCtx);
}

export function onResourceDidExecute(flowCtx: any): void {
  const resSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  if (!resSpan) return;
  recordStageEvent(resSpan, 'execute.done', flowCtx.state);
  endSpanOk(resSpan);
  flowCtx.state[EXEC_SPAN_KEY] = undefined;
  clearActiveSpan(flowCtx);
}

export function onResourceDidFinalize(flowCtx: any): void {
  const rpcSpan: Span | undefined = flowCtx.state?.[SPAN_KEY];
  const resSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  const error = flowCtx.state?.error;
  if (error) {
    if (resSpan) endSpanError(resSpan, error instanceof Error ? error : String(error));
    if (rpcSpan) endSpanError(rpcSpan, error instanceof Error ? error : String(error));
  } else if (rpcSpan) {
    recordStageEvent(rpcSpan, 'finalize', flowCtx.state);
    endSpanOk(rpcSpan);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Flow — prompts:get-prompt
// Stages: parseInput → ensureRemoteCapabilities → findPrompt →
//         createPromptContext → execute → validateOutput → finalize
// ─────────────────────────────────────────────────────────────────────────────

export function onPromptWillParse(options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;
  const ctx = extractContext(flowCtx);
  if (!ctx) return;

  const tracer = getTracer();
  const parentOTelCtx = createOTelContextFromTrace(ctx.traceContext);
  const sessionHash = sessionTracingId(ctx.sessionId);

  const { span, context: spanCtx } = startRpcSpan(tracer, {
    method: 'prompts/get',
    scopeId: ctx.scopeId,
    sessionIdHash: sessionHash,
    parentContext: parentOTelCtx,
  });

  flowCtx.state[SPAN_KEY] = span;
  flowCtx.state[SPAN_CTX_KEY] = spanCtx;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(span, 'parseInput', flowCtx.state);
}

export function onPromptWillFind(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'findPrompt', flowCtx.state);
}

export function onPromptWillExecute(options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;
  const rpcCtx: OTelContext | undefined = flowCtx.state?.[SPAN_CTX_KEY];
  const tracer = getTracer();
  const promptName = flowCtx.state?.input?.name ?? 'unknown';

  const { span: promptSpan, context: promptOTelCtx } = startPromptSpan(tracer, {
    name: promptName,
    parentContext: rpcCtx,
  });
  flowCtx.state[EXEC_SPAN_KEY] = promptSpan;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(promptSpan, 'execute.start', flowCtx.state);
  storeActiveSpan(flowCtx, promptSpan, promptOTelCtx);
}

export function onPromptDidExecute(flowCtx: any): void {
  const promptSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  if (!promptSpan) return;
  recordStageEvent(promptSpan, 'execute.done', flowCtx.state);
  endSpanOk(promptSpan);
  flowCtx.state[EXEC_SPAN_KEY] = undefined;
  clearActiveSpan(flowCtx);
}

export function onPromptDidFinalize(flowCtx: any): void {
  const rpcSpan: Span | undefined = flowCtx.state?.[SPAN_KEY];
  const promptSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  const error = flowCtx.state?.error;
  if (error) {
    if (promptSpan) endSpanError(promptSpan, error instanceof Error ? error : String(error));
    if (rpcSpan) endSpanError(rpcSpan, error instanceof Error ? error : String(error));
  } else if (rpcSpan) {
    recordStageEvent(rpcSpan, 'finalize', flowCtx.state);
    endSpanOk(rpcSpan);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Call Flow — agents:call-agent
// Stages: parseInput → findAgent → checkAgentAuthorization → createAgentContext →
//         acquireQuota → acquireSemaphore → validateInput → execute →
//         validateOutput → releaseSemaphore → releaseQuota → finalize
// ─────────────────────────────────────────────────────────────────────────────

export function onAgentWillParse(options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;
  const ctx = extractContext(flowCtx);
  if (!ctx) return;

  const tracer = getTracer();
  const parentOTelCtx = createOTelContextFromTrace(ctx.traceContext);
  const sessionHash = sessionTracingId(ctx.sessionId);

  const { span, context: spanCtx } = startRpcSpan(tracer, {
    method: 'agents/call',
    scopeId: ctx.scopeId,
    sessionIdHash: sessionHash,
    parentContext: parentOTelCtx,
  });

  flowCtx.state[SPAN_KEY] = span;
  flowCtx.state[SPAN_CTX_KEY] = spanCtx;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(span, 'parseInput', flowCtx.state);
}

export function onAgentWillFind(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, 'findAgent', flowCtx.state);
}

export function onAgentWillExecute(options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;
  const rpcCtx: OTelContext | undefined = flowCtx.state?.[SPAN_CTX_KEY];
  const tracer = getTracer();
  const agentName = flowCtx.state?.input?.name ?? 'unknown';

  const { span: agentSpan } = startSpan(tracer, {
    name: `agent ${agentName}`,
    kind: SpanKind.INTERNAL,
    attributes: {
      [FrontMcpAttributes.FLOW_NAME]: 'agents:call-agent',
      [McpAttributes.COMPONENT_TYPE]: 'agent',
      [McpAttributes.COMPONENT_KEY]: `agent:${agentName}`,
    },
    parentContext: rpcCtx,
  });

  const agentOTelCtx = trace.setSpan(rpcCtx ?? otelContext.active(), agentSpan);
  flowCtx.state[EXEC_SPAN_KEY] = agentSpan;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(agentSpan, 'execute.start', flowCtx.state);
  storeActiveSpan(flowCtx, agentSpan, agentOTelCtx);
}

export function onAgentDidExecute(flowCtx: any): void {
  const agentSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  if (!agentSpan) return;
  recordStageEvent(agentSpan, 'execute.done', flowCtx.state);
  endSpanOk(agentSpan);
  flowCtx.state[EXEC_SPAN_KEY] = undefined;
  clearActiveSpan(flowCtx);
}

export function onAgentDidFinalize(flowCtx: any): void {
  const rpcSpan: Span | undefined = flowCtx.state?.[SPAN_KEY];
  const agentSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  const error = flowCtx.state?.error;
  if (error) {
    if (agentSpan) endSpanError(agentSpan, error instanceof Error ? error : String(error));
    if (rpcSpan) endSpanError(rpcSpan, error instanceof Error ? error : String(error));
  } else if (rpcSpan) {
    recordStageEvent(rpcSpan, 'finalize', flowCtx.state);
    endSpanOk(rpcSpan);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic flow span helper for flows without dedicated hooks
// (skills, lists, completions, elicitation, auth)
// ─────────────────────────────────────────────────────────────────────────────

export function onGenericFlowWillStart(flowName: string, options: TracingOptions, flowCtx: any): void {
  if (options.executionSpans === false) return;
  const ctx = extractContext(flowCtx);
  if (!ctx) return;

  const tracer = getTracer();
  const parentOTelCtx = createOTelContextFromTrace(ctx.traceContext);
  const sessionHash = sessionTracingId(ctx.sessionId);

  const { span, context: spanCtx } = startSpan(tracer, {
    name: flowName,
    kind: SpanKind.INTERNAL,
    attributes: {
      [FrontMcpAttributes.FLOW_NAME]: flowName,
      [McpAttributes.SESSION_ID]: sessionHash,
      [FrontMcpAttributes.SESSION_ID_HASH]: sessionHash,
      [FrontMcpAttributes.SCOPE_ID]: ctx.scopeId,
      [FrontMcpAttributes.REQUEST_ID]: ctx.requestId,
    },
    parentContext: parentOTelCtx,
  });

  flowCtx.state[SPAN_KEY] = span;
  flowCtx.state[SPAN_CTX_KEY] = spanCtx;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
}

export function onGenericFlowStage(stageName: string, flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, stageName, flowCtx.state);
}

export function onGenericFlowDidFinalize(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (!span) return;
  const error = flowCtx.state?.error;
  if (error) {
    endSpanError(span, error instanceof Error ? error : String(error));
  } else {
    endSpanOk(span);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport Flow Hooks (SSE, Streamable HTTP, Stateless HTTP)
// ─────────────────────────────────────────────────────────────────────────────

import { startTransportSpan, setTransportRequestType } from '../otel/spans/transport.span';

export function onTransportWillStart(transportType: string, options: TracingOptions, flowCtx: any): void {
  if (options.transportSpans === false) return;
  const ctx = extractContext(flowCtx);
  if (!ctx) return;

  const tracer = getTracer();
  const parentOTelCtx = createOTelContextFromTrace(ctx.traceContext);
  const sessionHash = sessionTracingId(ctx.sessionId);

  const { span, context: spanCtx } = startTransportSpan(tracer, {
    type: transportType,
    sessionIdHash: sessionHash,
    parentContext: parentOTelCtx,
  });

  flowCtx.state[SPAN_KEY] = span;
  flowCtx.state[SPAN_CTX_KEY] = spanCtx;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(span, 'parseInput', flowCtx.state);
}

export function onTransportDidRoute(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (!span) return;
  recordStageEvent(span, 'router', flowCtx.state);
  // Record request type from state if available
  const requestType = flowCtx.state?.requestType;
  if (requestType) setTransportRequestType(span, requestType);
}

export function onTransportStage(stageName: string, flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, stageName, flowCtx.state);
}

export function onTransportDidFinalize(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (!span) return;
  recordStageEvent(span, 'cleanup', flowCtx.state);
  const error = flowCtx.state?.error;
  if (error) {
    endSpanError(span, error instanceof Error ? error : String(error));
  } else {
    endSpanOk(span);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Flow Hooks (auth:verify, session:verify)
// ─────────────────────────────────────────────────────────────────────────────

import { startAuthSpan, setAuthMode, setAuthResult } from '../otel/spans/auth.span';

export function onAuthWillStart(flowName: string, options: TracingOptions, flowCtx: any): void {
  if (options.authSpans === false) return;
  const ctx = extractContext(flowCtx);
  if (!ctx) return;

  const tracer = getTracer();
  const parentOTelCtx = createOTelContextFromTrace(ctx.traceContext);

  const { span, context: spanCtx } = startAuthSpan(tracer, {
    flowName,
    parentContext: parentOTelCtx,
  });

  flowCtx.state[SPAN_KEY] = span;
  flowCtx.state[SPAN_CTX_KEY] = spanCtx;
  flowCtx.state[STAGE_TS_KEY] = Date.now();
  recordStageEvent(span, 'parseInput', flowCtx.state);
}

export function onAuthDidDetermineMode(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (!span) return;
  recordStageEvent(span, 'determineAuthMode', flowCtx.state);
  const mode = flowCtx.state?.authMode;
  if (mode) setAuthMode(span, mode);
}

export function onAuthStage(stageName: string, flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (span) recordStageEvent(span, stageName, flowCtx.state);
}

export function onAuthDidFinalize(flowCtx: any): void {
  const span: Span | undefined = flowCtx.state?.[SPAN_KEY];
  if (!span) return;
  const error = flowCtx.state?.error;
  if (error) {
    setAuthResult(span, 'unauthorized');
    endSpanError(span, error instanceof Error ? error : String(error));
  } else {
    setAuthResult(span, 'authorized');
    endSpanOk(span);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Instrumentation (wraps ctx.fetch with OTel client spans)
// ─────────────────────────────────────────────────────────────────────────────

import { startFetchSpan, setFetchResponseStatus } from '../otel/spans/fetch.span';

export function wrapContextFetch(options: TracingOptions, flowCtx: any): void {
  if (options.fetchSpans === false) return;

  // Get the tool context from flow state
  const toolCtx = flowCtx.state?.toolContext ?? flowCtx.state?.toolCallContext;
  if (!toolCtx || typeof toolCtx.fetch !== 'function') return;

  const originalFetch = toolCtx.fetch.bind(toolCtx);
  const parentOTelCtx: OTelContext | undefined = flowCtx.state?.[SPAN_CTX_KEY];

  toolCtx.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';

    const tracer = getTracer();
    const { span } = startFetchSpan(tracer, { method, url, parentContext: parentOTelCtx });

    try {
      const response: Response = await originalFetch(input, init);
      setFetchResponseStatus(span, response.status);
      endSpanOk(span);
      return response;
    } catch (err) {
      endSpanError(span, err instanceof Error ? err : String(err));
      throw err;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Metadata Enrichment
// ─────────────────────────────────────────────────────────────────────────────

export function onAgentDidExecuteEnrich(flowCtx: any): void {
  const agentSpan: Span | undefined = flowCtx.state?.[EXEC_SPAN_KEY];
  if (!agentSpan) return;

  // Extract execution metadata (iterations, duration) if available
  const meta = flowCtx.state?.executionMeta;
  if (meta) {
    if (typeof meta.iterations === 'number') {
      agentSpan.setAttribute(FrontMcpAttributes.AGENT_ITERATIONS, meta.iterations);
    }
    if (typeof meta.durationMs === 'number') {
      agentSpan.setAttribute(FrontMcpAttributes.STARTUP_DURATION_MS, meta.durationMs);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup Report
// ─────────────────────────────────────────────────────────────────────────────

import { emitStartupReport, type StartupTelemetryData } from '../otel/spans/startup.span';

export function reportStartup(data: StartupTelemetryData): void {
  const tracer = getTracer();
  emitStartupReport(tracer, data);
}
