/**
 * Tool Execution Span — FrontMCP tool invocation instrumentation.
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { FrontMcpAttributes, McpAttributes, EnduserAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface ToolSpanOptions {
  /** Tool name */
  name: string;

  /** Tool owner class name */
  owner?: string;

  /** Enduser ID (from auth token, e.g., client ID) */
  enduserId?: string;

  /** Enduser scopes (space-separated OAuth scopes) */
  enduserScope?: string;

  /** Parent OTel context */
  parentContext?: Context;
}

/**
 * Start a tool execution span.
 *
 * Span name: "tool {name}"
 */
export function startToolSpan(tracer: Tracer, options: ToolSpanOptions): { span: Span; context: Context } {
  const attributes: Record<string, string | number | boolean> = {
    [FrontMcpAttributes.TOOL_NAME]: options.name,
    [McpAttributes.COMPONENT_TYPE]: 'tool',
    [McpAttributes.COMPONENT_KEY]: `tool:${options.name}`,
  };

  if (options.owner) {
    attributes[FrontMcpAttributes.TOOL_OWNER] = options.owner;
  }
  if (options.enduserId) {
    attributes[EnduserAttributes.ID] = options.enduserId;
  }
  if (options.enduserScope) {
    attributes[EnduserAttributes.SCOPE] = options.enduserScope;
  }

  return startSpan(tracer, {
    name: `tool ${options.name}`,
    kind: SpanKind.INTERNAL,
    attributes,
    parentContext: options.parentContext,
  });
}
