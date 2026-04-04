/**
 * Prompt Span — FrontMCP prompt invocation instrumentation.
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { FrontMcpAttributes, McpAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface PromptSpanOptions {
  /** Prompt name */
  name: string;

  /** Parent OTel context */
  parentContext?: Context;
}

/**
 * Start a prompt invocation span.
 *
 * Span name: "prompt {name}"
 */
export function startPromptSpan(tracer: Tracer, options: PromptSpanOptions): { span: Span; context: Context } {
  return startSpan(tracer, {
    name: `prompt ${options.name}`,
    kind: SpanKind.INTERNAL,
    attributes: {
      [FrontMcpAttributes.PROMPT_NAME]: options.name,
      [McpAttributes.COMPONENT_TYPE]: 'prompt',
      [McpAttributes.COMPONENT_KEY]: `prompt:${options.name}`,
    },
    parentContext: options.parentContext,
  });
}
