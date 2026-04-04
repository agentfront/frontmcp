import { LogTransportInterface, LogRecord, LogLevelName, LogTransport } from '@frontmcp/sdk';

import type { LogSink } from './log-sink.interface';
import type { StructuredLogEntry, StructuredLogTransportOptions } from './structured-log.types';
import { LOG_LEVEL_TO_OTEL_SEVERITY } from './structured-log.types';
import { redactFields } from './redaction';

/**
 * Context accessor function type.
 *
 * The transport calls this to get the current FrontMcpContext
 * from AsyncLocalStorage. Returns undefined when outside a request.
 */
export interface ContextAccessor {
  (): ContextSnapshot | undefined;
}

/**
 * Minimal context snapshot — avoids importing the full FrontMcpContext type.
 * Extracted by the plugin from FrontMcpContextStorage.getStore().
 */
export interface ContextSnapshot {
  requestId: string;
  traceContext: {
    traceId: string;
    parentId: string;
    traceFlags: number;
  };
  sessionIdHash: string;
  scopeId: string;
  flowName?: string;
  elapsed: number;
}

/**
 * StructuredLogTransport — bridges SDK logger → structured log objects → sinks.
 *
 * This is a LogTransportInterface implementation that:
 * 1. Receives LogRecord from the SDK logger
 * 2. Reads FrontMcpContext (if available) for trace correlation
 * 3. Builds a StructuredLogEntry object
 * 4. Applies field redaction
 * 5. Forwards to all registered LogSink instances
 */
@LogTransport({
  name: 'StructuredLogTransport',
  description: 'Produces structured log objects and forwards to configurable sinks',
})
export class StructuredLogTransport extends LogTransportInterface {
  private readonly sinks: LogSink[];
  private readonly redactFieldNames: string[];
  private readonly includeStacks: boolean;
  private readonly staticFields: Record<string, unknown>;
  private readonly getContext: ContextAccessor | undefined;

  /** Optional listener for request log collection */
  onEntry?: (entry: StructuredLogEntry) => void;

  constructor(sinks: LogSink[], options?: StructuredLogTransportOptions, contextAccessor?: ContextAccessor) {
    super();
    this.sinks = sinks;
    this.redactFieldNames = options?.redactFields ?? [];
    this.includeStacks = options?.includeStacks ?? true;
    this.staticFields = options?.staticFields ?? {};
    this.getContext = contextAccessor;
  }

  log(rec: LogRecord): void {
    const entry = this.buildEntry(rec);

    // Notify request log collector (if active)
    if (this.onEntry) {
      try {
        this.onEntry(entry);
      } catch {
        // onEntry errors must not break the logging pipeline
      }
    }

    // Forward to all sinks
    for (const sink of this.sinks) {
      try {
        sink.write(entry);
      } catch {
        // Sink errors must not break the logging pipeline
      }
    }
  }

  private buildEntry(rec: LogRecord): StructuredLogEntry {
    const levelName = (LogLevelName[rec.level] ?? 'info') as StructuredLogEntry['level'];

    const entry: StructuredLogEntry = {
      ...this.staticFields,
      timestamp: rec.timestamp.toISOString(),
      level: levelName,
      severity_number: LOG_LEVEL_TO_OTEL_SEVERITY[levelName] ?? 9,
      message: String(rec.message),
    };

    // Add prefix if present
    if (rec.prefix) {
      entry.prefix = rec.prefix;
    }

    // Enrich with context (if running inside a request)
    const ctx = this.getContext?.();
    if (ctx) {
      entry.trace_id = ctx.traceContext.traceId;
      entry.span_id = ctx.traceContext.parentId;
      entry.trace_flags = ctx.traceContext.traceFlags;
      entry.request_id = ctx.requestId;
      entry.session_id_hash = ctx.sessionIdHash;
      entry.scope_id = ctx.scopeId;
      if (ctx.flowName) {
        entry.flow_name = ctx.flowName;
      }
      entry.elapsed_ms = ctx.elapsed;
    }

    // Extract error and attributes from args
    this.processArgs(rec.args, entry);

    return entry;
  }

  private processArgs(args: unknown[], entry: StructuredLogEntry): void {
    const attributes: Record<string, unknown> = {};
    let hasAttributes = false;

    for (const arg of args) {
      if (arg instanceof Error) {
        entry.error = this.buildError(arg);
      } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        // Merge plain objects into attributes
        const obj = arg as Record<string, unknown>;
        const redacted = this.redactFieldNames.length > 0 ? redactFields(obj, this.redactFieldNames) : obj;
        Object.assign(attributes, redacted);
        hasAttributes = true;
      }
    }

    if (hasAttributes) {
      entry.attributes = attributes;
    }
  }

  private buildError(err: Error): StructuredLogEntry['error'] {
    const result: NonNullable<StructuredLogEntry['error']> = {
      type: err.constructor.name,
      message: err.message,
    };

    // Extract MCP error fields if present
    if ('code' in err && typeof (err as Record<string, unknown>).code === 'number') {
      result.code = String((err as Record<string, unknown>).code);
    }
    if ('errorId' in err && typeof (err as Record<string, unknown>).errorId === 'string') {
      result.error_id = (err as Record<string, unknown>).errorId as string;
    }

    if (this.includeStacks && err.stack) {
      result.stack = err.stack;
    }

    return result;
  }
}
