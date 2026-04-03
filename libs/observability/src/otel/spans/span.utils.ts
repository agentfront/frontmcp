/**
 * Span utility helpers for creating and managing OTel spans.
 */

import {
  type Tracer,
  type Span,
  type Context,
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  trace,
} from '@opentelemetry/api';

/**
 * Options for starting a span.
 */
export interface StartSpanOptions {
  /** Span name (follows OTel naming conventions) */
  name: string;

  /** Span kind (default: INTERNAL) */
  kind?: SpanKind;

  /** Span attributes */
  attributes?: Record<string, string | number | boolean>;

  /** Parent OTel context (default: current active context) */
  parentContext?: Context;
}

/**
 * Start a new span using the provided tracer.
 *
 * @returns The new span and the context with the span set as active.
 */
export function startSpan(tracer: Tracer, options: StartSpanOptions): { span: Span; context: Context } {
  const parentCtx = options.parentContext ?? otelContext.active();

  const span = tracer.startSpan(
    options.name,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: options.attributes,
    },
    parentCtx,
  );

  const spanContext = trace.setSpan(parentCtx, span);

  return { span, context: spanContext };
}

/**
 * End a span with success status.
 */
export function endSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * End a span with error status.
 */
export function endSpanError(span: Span, error: Error | string): void {
  const message = typeof error === 'string' ? error : error.message;

  span.setStatus({ code: SpanStatusCode.ERROR, message });

  if (error instanceof Error) {
    span.recordException(error);
  }

  span.end();
}

/**
 * Run a function within a span, automatically handling success/error.
 */
export async function withSpan<T>(
  tracer: Tracer,
  options: StartSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const { span, context: spanContext } = startSpan(tracer, options);

  return otelContext.with(spanContext, async () => {
    try {
      const result = await fn(span);
      endSpanOk(span);
      return result;
    } catch (err) {
      endSpanError(span, err instanceof Error ? err : String(err));
      throw err;
    }
  });
}
