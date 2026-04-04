/**
 * TraceContext Bridge — maps between FrontMCP's TraceContext
 * and OpenTelemetry's SpanContext.
 *
 * FrontMCP already has W3C Trace Context support in the SDK.
 * This bridge allows OTel spans to be created as children of
 * the existing trace, preserving the trace ID across the boundary.
 */

import {
  type SpanContext,
  TraceFlags,
  trace,
  context as otelContext,
  type Context as OTelContext,
} from '@opentelemetry/api';

/**
 * Minimal TraceContext interface — matches the SDK's TraceContext type
 * without importing it directly.
 */
export interface TraceContextLike {
  traceId: string;
  parentId: string;
  traceFlags: number;
  raw: string;
}

/**
 * Convert a FrontMCP TraceContext to an OTel SpanContext.
 *
 * Maps:
 * - traceId → traceId (32 hex chars)
 * - parentId → spanId (16 hex chars)
 * - traceFlags → traceFlags
 *
 * The resulting SpanContext is marked as remote (isRemote: true)
 * since it originated from an incoming request.
 */
export function frontmcpToOTelSpanContext(tc: TraceContextLike): SpanContext {
  return {
    traceId: tc.traceId,
    spanId: tc.parentId,
    traceFlags: tc.traceFlags & TraceFlags.SAMPLED ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
}

/**
 * Convert an OTel SpanContext back to a FrontMCP TraceContext.
 */
export function otelToFrontmcpContext(sc: SpanContext): TraceContextLike {
  const flags = sc.traceFlags.toString(16).padStart(2, '0');
  return {
    traceId: sc.traceId,
    parentId: sc.spanId,
    traceFlags: sc.traceFlags,
    raw: `00-${sc.traceId}-${sc.spanId}-${flags}`,
  };
}

/**
 * Create an OTel Context with the FrontMCP TraceContext as the
 * active remote parent span. All child spans created within
 * this context will share the same traceId.
 */
export function createOTelContextFromTrace(tc: TraceContextLike): OTelContext {
  const spanContext = frontmcpToOTelSpanContext(tc);
  const span = trace.wrapSpanContext(spanContext);
  return trace.setSpan(otelContext.active(), span);
}
