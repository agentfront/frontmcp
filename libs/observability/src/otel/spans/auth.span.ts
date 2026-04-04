/**
 * Auth Span — authentication and session verification instrumentation.
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { FrontMcpAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface AuthSpanOptions {
  /** Auth flow name (e.g., "auth:verify", "session:verify") */
  flowName: string;

  /** Parent OTel context */
  parentContext?: Context;
}

/**
 * Start an auth span.
 *
 * Span name: "auth {flowName}"
 */
export function startAuthSpan(tracer: Tracer, options: AuthSpanOptions): { span: Span; context: Context } {
  return startSpan(tracer, {
    name: `auth ${options.flowName}`,
    kind: SpanKind.INTERNAL,
    attributes: {
      [FrontMcpAttributes.FLOW_NAME]: options.flowName,
    },
    parentContext: options.parentContext,
  });
}

/**
 * Set auth mode on the span.
 */
export function setAuthMode(span: Span, mode: string): void {
  span.setAttribute(FrontMcpAttributes.AUTH_MODE, mode);
}

/**
 * Set auth result on the span.
 */
export function setAuthResult(span: Span, result: string): void {
  span.setAttribute(FrontMcpAttributes.AUTH_RESULT, result);
}
