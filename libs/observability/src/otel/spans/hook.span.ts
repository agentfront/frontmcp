/**
 * Hook Span — FrontMCP hook execution instrumentation.
 *
 * By default, hook executions are recorded as span events (not child spans)
 * to keep trace depth manageable. When hookSpans is enabled, each hook
 * gets its own child span.
 */

import { type Tracer, type Span, type Context, SpanKind } from '@opentelemetry/api';
import { FrontMcpAttributes } from '../otel.types';
import { startSpan } from './span.utils';

export interface HookSpanOptions {
  /** Hook stage name (e.g., "willExecute") */
  stage: string;

  /** Hook owner identifier */
  owner?: string;

  /** Flow name (e.g., "tools:call-tool") */
  flowName?: string;

  /** Parent OTel context */
  parentContext?: Context;
}

/**
 * Record a hook execution as a span event on the parent span.
 *
 * This is the default behavior — lightweight, no trace depth increase.
 */
export function recordHookEvent(parentSpan: Span, stage: string, owner?: string): void {
  const attributes: Record<string, string> = {};
  if (owner) {
    attributes[FrontMcpAttributes.HOOK_OWNER] = owner;
  }

  parentSpan.addEvent(`hook.${stage}`, attributes);
}

/**
 * Start a dedicated hook span (verbose mode).
 *
 * Only used when hookSpans is enabled in the tracing options.
 */
export function startHookSpan(tracer: Tracer, options: HookSpanOptions): { span: Span; context: Context } {
  const attributes: Record<string, string | number | boolean> = {
    [FrontMcpAttributes.HOOK_STAGE]: options.stage,
  };

  if (options.owner) {
    attributes[FrontMcpAttributes.HOOK_OWNER] = options.owner;
  }
  if (options.flowName) {
    attributes[FrontMcpAttributes.FLOW_NAME] = options.flowName;
  }

  return startSpan(tracer, {
    name: `hook ${options.stage}`,
    kind: SpanKind.INTERNAL,
    attributes,
    parentContext: options.parentContext,
  });
}
