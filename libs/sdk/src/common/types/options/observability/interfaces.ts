/**
 * Observability configuration options.
 *
 * Controls OpenTelemetry tracing, structured logging sinks,
 * and per-request log collection.
 *
 * @example
 * ```typescript
 * @FrontMcp({
 *   observability: {
 *     tracing: true,
 *     logging: { sinks: [{ type: 'stdout' }] },
 *     requestLogs: true,
 *   },
 * })
 * ```
 */
export interface ObservabilityOptionsInterface {
  /**
   * Enable/configure OpenTelemetry tracing.
   *
   * - `true` — enable all spans with defaults
   * - `false` — disable tracing
   * - Object — fine-grained control per span type
   *
   * Requires a TracerProvider to be configured (via setupOTel or external SDK).
   * Without one, all operations are no-ops with zero overhead.
   *
   * @default true
   */
  tracing?:
    | boolean
    | {
        httpSpans?: boolean;
        executionSpans?: boolean;
        hookSpans?: boolean;
        fetchSpans?: boolean;
        flowStageEvents?: boolean;
        transportSpans?: boolean;
        authSpans?: boolean;
        oauthSpans?: boolean;
        elicitationSpans?: boolean;
        startupReport?: boolean;
      };

  /**
   * Enable/configure structured JSON logging.
   *
   * - `true` — enable with default StdoutSink (NDJSON)
   * - `false` — disable structured logging
   * - Object — configure sinks, redaction, etc.
   *
   * @default false
   */
  logging?:
    | boolean
    | {
        sinks?: Array<{ type: string; [key: string]: unknown }>;
        redactFields?: string[];
        includeStacks?: boolean;
        staticFields?: Record<string, unknown>;
      };

  /**
   * Enable/configure per-request log collection.
   *
   * - `true` — enable with defaults
   * - `false` — disable
   * - Object — configure max entries, callback, etc.
   *
   * @default false
   */
  requestLogs?:
    | boolean
    | {
        maxEntries?: number;
        includeSummaries?: boolean;
        onRequestComplete?: (log: unknown) => void | Promise<void>;
      };
}
