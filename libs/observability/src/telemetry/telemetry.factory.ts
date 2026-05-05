/**
 * TelemetryFactory — SCOPE-scoped helper for creating counters and spans
 * without requiring an active request context.
 *
 * `TelemetryAccessor` is CONTEXT-scoped (one per request) so it can read
 * the active flow span and attach base attributes (request ID, session ID,
 * etc). That's correct for tool/resource/prompt code paths but the wrong
 * lifetime for scope-lifetime singletons:
 *
 *   - `BundleStore` is constructed at scope-init and lives for the life
 *     of the scope. Its `swap()` may be invoked from a source's onChange
 *     callback (no request context) or from a meta-tool call (request
 *     context). Either way it just needs counters that work, and spans
 *     parented to whatever active OTel context is on the stack.
 *
 * The factory wraps the same process-global `createCounter` exported from
 * this package, plus a tracer so callers can start spans. `startSpan`
 * uses `trace.setSpan(context.active(), ...)` semantics implicitly via
 * `tracer.startSpan` so callers nest correctly when a parent span exists.
 *
 * @see TELEMETRY_FACTORY
 */

import { SpanStatusCode, trace, type Context as OTelContext, type Tracer } from '@opentelemetry/api';

import { TelemetrySpan } from './telemetry.accessor';
import { createCounter, type TelemetryCounter } from './telemetry.counters';

export class TelemetryFactory {
  private readonly tracer: Tracer;

  constructor(tracerName = '@frontmcp/observability') {
    this.tracer = trace.getTracer(tracerName);
  }

  /**
   * Create (or retrieve cached) a named counter. Increments propagate to
   * the OTel meter (when configured) and to the in-memory snapshot store.
   *
   * @param name        - OTel-style snake_case name with `_total` suffix.
   * @param description - human-readable description (deduped: subsequent
   *                      calls with a different description return the
   *                      cached counter unchanged).
   */
  createCounter(name: string, description?: string): TelemetryCounter {
    return createCounter(name, description);
  }

  /**
   * Start a span. Caller is responsible for calling `end()` /
   * `endWithError()`. The span parents to the currently-active OTel
   * context; if none is active it becomes a root span.
   */
  startSpan(name: string, attributes?: Record<string, string | number | boolean>, parent?: OTelContext): TelemetrySpan {
    const span = parent
      ? this.tracer.startSpan(name, attributes ? { attributes } : undefined, parent)
      : this.tracer.startSpan(name, attributes ? { attributes } : undefined);
    if (attributes) span.setAttributes(attributes);
    return new TelemetrySpan(span);
  }

  /**
   * Convenience wrapper — start a span, run `fn` with it, end on success
   * or error. Same lifecycle as `TelemetryAccessor.withSpan` but without
   * the per-request base attributes.
   */
  async withSpan<T>(
    name: string,
    fn: (span: TelemetrySpan) => Promise<T>,
    attributes?: Record<string, string | number | boolean>,
  ): Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (err) {
      span.endWithError(err instanceof Error ? err : String(err));
      throw err;
    }
  }
}

// Reference SpanStatusCode so the import is preserved through tree-shaking
// even when nobody calls `withSpan` (it's used inside `endWithError`).
void SpanStatusCode;
