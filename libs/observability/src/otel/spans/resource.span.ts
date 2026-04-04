/**
 * Resource Read Span — FrontMCP resource read instrumentation.
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { FrontMcpAttributes, McpAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface ResourceSpanOptions {
  /** Resource URI */
  uri: string;

  /** Resource name */
  name?: string;

  /** Parent OTel context */
  parentContext?: Context;
}

/**
 * Start a resource read span.
 *
 * Span name: "resource {uri}"
 */
export function startResourceSpan(tracer: Tracer, options: ResourceSpanOptions): { span: Span; context: Context } {
  const attributes: Record<string, string | number | boolean> = {
    [FrontMcpAttributes.RESOURCE_URI]: options.uri,
    [McpAttributes.RESOURCE_URI]: options.uri,
    [McpAttributes.COMPONENT_TYPE]: 'resource',
    [McpAttributes.COMPONENT_KEY]: `resource:${options.uri}`,
  };

  if (options.name) {
    attributes[FrontMcpAttributes.RESOURCE_NAME] = options.name;
  }

  return startSpan(tracer, {
    name: `resource ${options.uri}`,
    kind: SpanKind.INTERNAL,
    attributes,
    parentContext: options.parentContext,
  });
}
