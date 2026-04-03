/**
 * Structured log entry — the core log object.
 *
 * Every log entry produced by StructuredLogTransport is a plain
 * StructuredLogEntry object. Output adapters (sinks) serialize
 * it for their target (NDJSON → stdout, winston → winston transport, etc.).
 */
export interface StructuredLogEntry {
  /** ISO 8601 timestamp (e.g., "2026-03-31T14:22:05.123Z") */
  timestamp: string;

  /** Log level name */
  level: 'debug' | 'verbose' | 'info' | 'warn' | 'error';

  /** OTel severity number (1–24) for log correlation */
  severity_number: number;

  /** Log message */
  message: string;

  /** W3C trace ID (32 hex chars) — from FrontMcpContext */
  trace_id?: string;

  /** OTel span ID (16 hex chars) — from FrontMcpContext.traceContext.parentId */
  span_id?: string;

  /** W3C trace flags */
  trace_flags?: number;

  /** Unique request identifier — from FrontMcpContext */
  request_id?: string;

  /** SHA-256 truncated session ID (12 chars) — from FrontMcpContext */
  session_id_hash?: string;

  /** Scope identifier — from FrontMcpContext */
  scope_id?: string;

  /** Current flow name — from FrontMcpContext */
  flow_name?: string;

  /** Logger child prefix chain */
  prefix?: string;

  /** Error details (populated when level = error and args contain an Error) */
  error?: StructuredLogError;

  /** Elapsed time since request start in milliseconds */
  elapsed_ms?: number;

  /** Structured attributes extracted from log args */
  attributes?: Record<string, unknown>;
}

/**
 * Structured error information.
 */
export interface StructuredLogError {
  /** Error class name */
  type: string;

  /** Error message */
  message: string;

  /** MCP error code (if applicable) */
  code?: string;

  /** Unique error tracking ID (from McpError.errorId) */
  error_id?: string;

  /** Stack trace (only included when includeStacks is true) */
  stack?: string;
}

/**
 * Options for StructuredLogTransport.
 */
export interface StructuredLogTransportOptions {
  /** Field names to redact from attributes */
  redactFields?: string[];

  /** Whether to include stack traces in error entries (default: true) */
  includeStacks?: boolean;

  /** Static fields to include in every log entry */
  staticFields?: Record<string, unknown>;
}

/**
 * OTel severity numbers mapped from FrontMCP LogLevel.
 *
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/#severity-fields
 */
export const LOG_LEVEL_TO_OTEL_SEVERITY: Record<string, number> = {
  debug: 5, // DEBUG
  verbose: 9, // DEBUG2 (verbose is between debug and info)
  info: 9, // INFO
  warn: 13, // WARN
  error: 17, // ERROR
};
