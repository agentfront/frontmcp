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

  /**
   * Report event-loop stalls: a warning naming the calls in flight (never their inputs), the
   * `frontmcp_event_loop_stall_seconds_total` counter and a dev event. GC pauses are counted apart.
   *
   * - `true` — report stalls of 200 ms or more
   * - Object — `thresholdMs`, from 20 to 60000
   *
   * @default false
   */
  stalls?: boolean | { thresholdMs?: number };

  /**
   * The `frontmcp dev` event stream: call timings, failures and stalls as JSON Lines. On only in
   * development (under `frontmcp dev`, or with `NODE_ENV=development` and a file or sink set).
   *
   * - `false` — no dev events
   * - Object — `file` (JSON Lines), `sinks` (objects with `write(events)`), `maxQueue` (1000)
   *
   * @default true
   */
  devEvents?:
    | boolean
    | {
        file?: string;
        sinks?: Array<{ name?: string; write(events: readonly unknown[]): void | Promise<void> }>;
        maxQueue?: number;
      };
}
