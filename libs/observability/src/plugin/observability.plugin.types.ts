import type { TracingOptions } from '../otel/otel.types';
import type { SinkConfig } from '../logging/log-sink.interface';
import type { RequestLogCollectorOptions } from '../request-log/request-log.types';

/**
 * Full resolved options for ObservabilityPlugin.
 */
export interface ObservabilityPluginOptions {
  /** OTel tracing configuration */
  tracing: TracingOptions | false;

  /** Structured logging configuration */
  logging: ObservabilityLoggingOptions | false;

  /** Request log collection configuration */
  requestLogs: RequestLogCollectorOptions | false;
}

/**
 * Logging options within the plugin.
 */
export interface ObservabilityLoggingOptions {
  /** Sink configurations (default: StdoutSink in Node.js, ConsoleSink in browser) */
  sinks?: SinkConfig[];

  /** Field names to redact from log attributes */
  redactFields?: string[];

  /** Include stack traces in error entries (default: true) */
  includeStacks?: boolean;

  /** Static fields to include in every log entry */
  staticFields?: Record<string, unknown>;
}

/**
 * User-facing input options (everything is optional).
 */
export interface ObservabilityPluginOptionsInput {
  /** Enable/configure OTel tracing (default: true with all spans enabled) */
  tracing?: boolean | TracingOptions;

  /** Enable/configure structured logging */
  logging?: boolean | ObservabilityLoggingOptions;

  /** Enable/configure request log collection */
  requestLogs?: boolean | RequestLogCollectorOptions;
}
