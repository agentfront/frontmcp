/**
 * TelemetryAccessor — developer-facing telemetry API.
 *
 * Exposed as `this.telemetry` on all execution contexts (ToolContext,
 * ResourceContext, PromptContext, AgentContext) when ObservabilityPlugin
 * is installed.
 *
 * Key design: `addEvent()` and `setAttributes()` target the **active
 * flow execution span** (e.g., the tool span during tool.execute()).
 * This means events appear in the correct parent span timeline,
 * not as detached spans.
 *
 * `startSpan()` and `withSpan()` create child spans under the active
 * execution span, so they nest correctly in the trace.
 *
 * @example
 * ```typescript
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     // Events go directly on the tool's execution span
 *     this.telemetry.addEvent('validation-complete', { valid: true });
 *     this.telemetry.setAttributes({ 'user.tier': 'premium' });
 *
 *     // Child span — nested under the tool span
 *     const result = await this.telemetry.withSpan('fetch-api', async (span) => {
 *       const res = await this.fetch('https://api.example.com');
 *       span.setAttribute('response.status', res.status);
 *       return res.json();
 *     });
 *   }
 * }
 * ```
 */

import {
  type Tracer,
  type Span,
  type Context as OTelContext,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

import { createOTelContextFromTrace, type TraceContextLike } from '../otel/trace-context-bridge';
import { sessionTracingId, ACTIVE_SPAN_KEY, ACTIVE_OTEL_CTX_KEY } from '../plugin/observability.hooks';
import { FrontMcpAttributes, McpAttributes } from '../otel/otel.types';

/**
 * Minimal context shape — avoids tight coupling to FrontMcpContext.
 */
interface TelemetryContextData {
  requestId: string;
  sessionId: string;
  scopeId: string;
  traceContext: TraceContextLike;
  /** FrontMcpContext.get() for reading the active span */
  get?<T>(key: string | symbol): T | undefined;
}

/**
 * A lightweight span wrapper for developer use.
 * Hides OTel complexity while preserving full functionality.
 */
export class TelemetrySpan {
  private hasError = false;

  constructor(private readonly span: Span) {}

  /** Set a string/number/boolean attribute */
  setAttribute(key: string, value: string | number | boolean): this {
    this.span.setAttribute(key, value);
    return this;
  }

  /** Set multiple attributes at once */
  setAttributes(attrs: Record<string, string | number | boolean>): this {
    this.span.setAttributes(attrs);
    return this;
  }

  /** Add a named event (with optional attributes) */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): this {
    this.span.addEvent(name, attributes);
    return this;
  }

  /** Record an error on this span */
  recordError(error: Error): this {
    this.span.recordException(error);
    this.span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    this.hasError = true;
    return this;
  }

  /** End the span (preserves ERROR status if already set) */
  end(): void {
    if (!this.hasError) {
      this.span.setStatus({ code: SpanStatusCode.OK });
    }
    this.span.end();
  }

  /** End the span with error */
  endWithError(error: Error | string): void {
    const msg = typeof error === 'string' ? error : error.message;
    if (error instanceof Error) this.span.recordException(error);
    this.span.setStatus({ code: SpanStatusCode.ERROR, message: msg });
    this.span.end();
  }

  /** Get the underlying OTel span (escape hatch) */
  get raw(): Span {
    return this.span;
  }
}

/**
 * TelemetryAccessor — the developer-facing API exposed as `this.telemetry`.
 *
 * One instance per request (CONTEXT-scoped). Automatically inherits
 * the request's trace context for seamless span correlation.
 *
 * `addEvent` and `setAttributes` target the active flow span (set by
 * the auto-instrumentation hooks during willExecute). `startSpan` and
 * `withSpan` create child spans under the active flow span.
 */
export class TelemetryAccessor {
  private readonly tracer: Tracer;
  private readonly fallbackContext: OTelContext;
  private readonly sessionHash: string;
  private readonly baseAttributes: Record<string, string>;
  private readonly ctx: TelemetryContextData;

  constructor(ctx: TelemetryContextData) {
    this.ctx = ctx;
    this.tracer = trace.getTracer('@frontmcp/observability');
    this.fallbackContext = createOTelContextFromTrace(ctx.traceContext);
    this.sessionHash = sessionTracingId(ctx.sessionId);

    this.baseAttributes = {
      [FrontMcpAttributes.REQUEST_ID]: ctx.requestId,
      [FrontMcpAttributes.SCOPE_ID]: ctx.scopeId,
      [McpAttributes.SESSION_ID]: this.sessionHash,
    };
  }

  /**
   * Get the active OTel context — prefers the execution span's context
   * (set by hooks during willExecute), falls back to the request-level trace.
   */
  private getActiveContext(): OTelContext {
    const otelCtx = this.ctx.get?.<OTelContext>(ACTIVE_OTEL_CTX_KEY);
    return otelCtx ?? this.fallbackContext;
  }

  /**
   * Get the active execution span (set by auto-instrumentation hooks).
   * Returns undefined if not inside an instrumented execution stage.
   */
  private getActiveSpan(): Span | undefined {
    return this.ctx.get?.<Span>(ACTIVE_SPAN_KEY);
  }

  /**
   * Start a new child span under the current execution span.
   *
   * If called inside a tool's execute(), the span is a child of
   * the tool execution span. Otherwise falls back to the request trace.
   *
   * You MUST call `span.end()` or `span.endWithError()` when done.
   */
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): TelemetrySpan {
    const span = this.tracer.startSpan(
      name,
      {
        kind: SpanKind.INTERNAL,
        attributes: { ...this.baseAttributes, ...attributes },
      },
      this.getActiveContext(),
    );
    return new TelemetrySpan(span);
  }

  /**
   * Run a function within a child span. Automatically ended on
   * success (OK) or error (ERROR + exception recorded).
   *
   * @example
   * ```typescript
   * const data = await this.telemetry.withSpan('fetch-api', async (span) => {
   *   span.addEvent('request-sent');
   *   const res = await this.fetch(url);
   *   span.setAttribute('status', res.status);
   *   return res.json();
   * });
   * ```
   */
  async withSpan<T>(
    name: string,
    fn: (span: TelemetrySpan) => Promise<T>,
    attributes?: Record<string, string | number | boolean>,
  ): Promise<T> {
    const telemetrySpan = this.startSpan(name, attributes);
    try {
      const result = await fn(telemetrySpan);
      telemetrySpan.end();
      return result;
    } catch (err) {
      telemetrySpan.endWithError(err instanceof Error ? err : String(err));
      throw err;
    }
  }

  /**
   * Add an event to the **active flow execution span**.
   *
   * If called inside a tool's execute(), the event appears on the
   * tool execution span. If no active span exists, creates a
   * lightweight child span carrying the event.
   *
   * @param name — event name (e.g., 'validation-complete', 'cache-hit')
   * @param attributes — optional event attributes
   */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    const activeSpan = this.getActiveSpan();
    if (activeSpan) {
      // Best case: event goes directly on the execution span
      activeSpan.addEvent(name, attributes);
    } else {
      // Fallback: create a short-lived child span
      const span = this.tracer.startSpan(
        name,
        { kind: SpanKind.INTERNAL, attributes: this.baseAttributes },
        this.fallbackContext,
      );
      if (attributes) span.addEvent(name, attributes);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    }
  }

  /**
   * Set attributes on the **active flow execution span**.
   *
   * If called inside a tool's execute(), attributes are set on the
   * tool execution span. If no active span exists, this is a no-op.
   *
   * @param attrs — key-value attributes
   */
  setAttributes(attrs: Record<string, string | number | boolean>): void {
    const activeSpan = this.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttributes(attrs);
    }
  }

  /**
   * Get the trace ID of the current request.
   * Useful for including in external API calls or logs.
   */
  get traceId(): string {
    return trace.getSpan(this.fallbackContext)?.spanContext().traceId ?? '';
  }

  /**
   * Get the session tracing ID (privacy-safe hash).
   */
  get sessionId(): string {
    return this.sessionHash;
  }
}
