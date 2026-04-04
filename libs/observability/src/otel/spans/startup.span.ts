/**
 * Startup Report Span — emits server initialization telemetry.
 *
 * Created as a standalone span after scope initialization completes.
 * Records counts of registered components and initialization duration.
 */

import { type Tracer, SpanKind } from '@opentelemetry/api';
import { FrontMcpAttributes } from '../otel.types';
import { startSpan, endSpanOk } from './span.utils';

export interface StartupTelemetryData {
  /** Total tools registered */
  toolsCount: number;

  /** Total resources registered */
  resourcesCount: number;

  /** Total prompts registered */
  promptsCount: number;

  /** Total plugins loaded */
  pluginsCount: number;

  /** Initialization duration in ms */
  durationMs: number;

  /** Scope/server name */
  scopeId?: string;
}

/**
 * Emit a startup telemetry report as a standalone span.
 *
 * Creates and immediately ends a span with all startup metrics
 * as attributes. Call this after scope.initialize() completes.
 */
export function emitStartupReport(tracer: Tracer, data: StartupTelemetryData): void {
  const attributes: Record<string, string | number | boolean> = {
    [FrontMcpAttributes.STARTUP_TOOLS_COUNT]: data.toolsCount,
    [FrontMcpAttributes.STARTUP_RESOURCES_COUNT]: data.resourcesCount,
    [FrontMcpAttributes.STARTUP_PROMPTS_COUNT]: data.promptsCount,
    [FrontMcpAttributes.STARTUP_PLUGINS_COUNT]: data.pluginsCount,
    [FrontMcpAttributes.STARTUP_DURATION_MS]: data.durationMs,
  };

  if (data.scopeId) {
    attributes[FrontMcpAttributes.SCOPE_ID] = data.scopeId;
  }

  const { span } = startSpan(tracer, {
    name: 'frontmcp.startup',
    kind: SpanKind.INTERNAL,
    attributes,
  });

  endSpanOk(span);
}
