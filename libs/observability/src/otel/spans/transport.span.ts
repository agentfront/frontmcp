/**
 * Transport Span — SSE, Streamable HTTP, Stateless HTTP instrumentation.
 *
 * Created for each transport-level flow that handles session creation,
 * protocol routing, and message dispatch.
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { FrontMcpAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface TransportSpanOptions {
  /** Transport type: "legacy-sse" | "streamable-http" | "stateless-http" */
  type: string;

  /** Session tracing ID (hashed) */
  sessionIdHash?: string;

  /** Whether a new session was created */
  sessionCreated?: boolean;

  /** Parent OTel context */
  parentContext?: Context;
}

/**
 * Start a transport span.
 *
 * Span name: "transport {type}"
 */
export function startTransportSpan(tracer: Tracer, options: TransportSpanOptions): { span: Span; context: Context } {
  const attributes: Record<string, string | number | boolean> = {
    [FrontMcpAttributes.TRANSPORT_TYPE]: options.type,
  };

  if (options.sessionIdHash) {
    attributes[FrontMcpAttributes.SESSION_ID_HASH] = options.sessionIdHash;
  }
  if (options.sessionCreated !== undefined) {
    attributes[FrontMcpAttributes.SESSION_CREATED] = options.sessionCreated;
  }

  return startSpan(tracer, {
    name: `transport ${options.type}`,
    kind: SpanKind.INTERNAL,
    attributes,
    parentContext: options.parentContext,
  });
}

/**
 * Set the request type on a transport span.
 */
export function setTransportRequestType(span: Span, requestType: string): void {
  span.setAttribute(FrontMcpAttributes.TRANSPORT_REQUEST_TYPE, requestType);
}
