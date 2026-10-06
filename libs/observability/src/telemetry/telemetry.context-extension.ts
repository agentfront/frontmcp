/**
 * Module augmentation for TypeScript — adds `this.telemetry` to every
 * execution context: ExecutionContextBase (ToolContext, ResourceContext,
 * AgentContext, JobContext, SkillContext, PromptContext, ...).
 *
 * This file provides type information only. The runtime getter is
 * installed by the SDK's context extension mechanism when the
 * ObservabilityPlugin registers its `contextExtensions`, on
 * ExecutionContextBase.prototype, which PromptContext inherits.
 */

import type { TelemetryAccessor } from './telemetry.accessor';

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    /**
     * Telemetry API — create spans, add events, set attributes.
     *
     * Available when ObservabilityPlugin is installed.
     * Automatically inherits the current request's trace context.
     *
     * @example
     * ```typescript
     * // Create a child span
     * const span = this.telemetry.startSpan('my-operation');
     * span.setAttribute('key', 'value');
     * span.end();
     *
     * // Auto-managed span
     * await this.telemetry.withSpan('fetch-data', async (span) => {
     *   const data = await this.fetch(url);
     *   span.addEvent('data-received', { count: data.length });
     *   return data;
     * });
     * ```
     */
    readonly telemetry: TelemetryAccessor;
  }

  interface PromptContext {
    /** Telemetry API — create spans, add events, set attributes. Available when ObservabilityPlugin is installed. */
    readonly telemetry: TelemetryAccessor;
  }
}
