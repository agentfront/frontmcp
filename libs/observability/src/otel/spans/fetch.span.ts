/**
 * Fetch Span — outbound HTTP client instrumentation.
 *
 * Wraps fetch() calls made via FrontMcpContext.fetch() to create
 * client HTTP spans following OTel HTTP semantic conventions.
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { HttpAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface FetchSpanOptions {
  /** HTTP method */
  method: string;

  /** Full URL */
  url: string;

  /** Parent OTel context */
  parentContext?: Context;
}

/**
 * Start an outbound HTTP client span.
 *
 * Span name follows OTel convention: "{method}"
 */
export function startFetchSpan(tracer: Tracer, options: FetchSpanOptions): { span: Span; context: Context } {
  return startSpan(tracer, {
    name: options.method.toUpperCase(),
    kind: SpanKind.CLIENT,
    attributes: {
      [HttpAttributes.METHOD]: options.method.toUpperCase(),
      [HttpAttributes.URL_FULL]: options.url,
    },
    parentContext: options.parentContext,
  });
}

/**
 * Set the response status on a fetch span.
 */
export function setFetchResponseStatus(span: Span, statusCode: number): void {
  span.setAttribute(HttpAttributes.STATUS_CODE, statusCode);
}
