/**
 * HTTP Server Span — follows OTel HTTP semantic conventions.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/http/http-spans/
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { HttpAttributes, FrontMcpAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface HttpServerSpanOptions {
  method: string;
  path: string;
  scheme?: string;
  serverAddress?: string;
  serverPort?: number;
  scopeId?: string;
  requestId?: string;
  parentContext?: Context;
}

/**
 * Start an HTTP server span.
 *
 * Span name follows OTel convention: "{method} {path}"
 */
export function startHttpServerSpan(tracer: Tracer, options: HttpServerSpanOptions): { span: Span; context: Context } {
  const attributes: Record<string, string | number | boolean> = {
    [HttpAttributes.METHOD]: options.method.toUpperCase(),
    [HttpAttributes.URL_PATH]: options.path,
  };

  if (options.scheme) {
    attributes[HttpAttributes.URL_SCHEME] = options.scheme;
  }
  if (options.serverAddress) {
    attributes[HttpAttributes.SERVER_ADDRESS] = options.serverAddress;
  }
  if (options.serverPort) {
    attributes[HttpAttributes.SERVER_PORT] = options.serverPort;
  }
  if (options.scopeId) {
    attributes[FrontMcpAttributes.SCOPE_ID] = options.scopeId;
  }
  if (options.requestId) {
    attributes[FrontMcpAttributes.REQUEST_ID] = options.requestId;
  }

  return startSpan(tracer, {
    name: `${options.method.toUpperCase()} ${options.path}`,
    kind: SpanKind.SERVER,
    attributes,
    parentContext: options.parentContext,
  });
}

/**
 * Set the HTTP response status code on a server span.
 */
export function setHttpResponseStatus(span: Span, statusCode: number): void {
  span.setAttribute(HttpAttributes.STATUS_CODE, statusCode);
}
