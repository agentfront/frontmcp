import type { StructuredLogEntry } from './structured-log.types';

/**
 * LogSink — pluggable output adapter for structured log entries.
 *
 * Implementations determine where and how log objects are written:
 * - StdoutSink: NDJSON to process.stdout (12-factor)
 * - ConsoleSink: console.log/warn/error (browser-safe)
 * - WinstonSink: forward to winston logger instance
 * - PinoSink: forward to pino logger instance
 * - CallbackSink: user-provided callback function
 */
export interface LogSink {
  /** Write a structured log entry to the output */
  write(entry: StructuredLogEntry): void;

  /** Optional: flush buffered entries */
  flush?(): Promise<void>;

  /** Optional: cleanup resources */
  close?(): Promise<void>;
}

/**
 * Sink configuration — discriminated union for built-in sink types.
 */
export type SinkConfig =
  | StdoutSinkConfig
  | ConsoleSinkConfig
  | WinstonSinkConfig
  | PinoSinkConfig
  | CallbackSinkConfig
  | OtlpSinkConfig;

export interface StdoutSinkConfig {
  type: 'stdout';
  /** Writable stream override (default: process.stdout) */
  stream?: NodeJS.WritableStream;
  /** Pretty-print JSON (default: false) */
  pretty?: boolean;
}

export interface ConsoleSinkConfig {
  type: 'console';
}

export interface WinstonSinkConfig {
  type: 'winston';
  /** Winston logger instance */
  logger: WinstonLike;
}

export interface PinoSinkConfig {
  type: 'pino';
  /** Pino logger instance */
  logger: PinoLike;
}

export interface CallbackSinkConfig {
  type: 'callback';
  /** User-provided callback */
  fn: (entry: StructuredLogEntry) => void;
}

export interface OtlpSinkConfig {
  type: 'otlp';
  /** OTLP endpoint (e.g., 'http://localhost:4318'). Path '/v1/logs' is appended. */
  endpoint?: string;
  /** Custom headers (for auth tokens, API keys) */
  headers?: Record<string, string>;
  /** Max batch size before auto-flush (default: 100) */
  batchSize?: number;
  /** Flush interval in ms (default: 5000) */
  flushIntervalMs?: number;
  /** Service name for resource identification */
  serviceName?: string;
}

/**
 * Minimal winston-compatible logger interface.
 * Avoids hard dependency on winston types.
 */
export interface WinstonLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Minimal pino-compatible logger interface.
 * Avoids hard dependency on pino types.
 */
export interface PinoLike {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}
