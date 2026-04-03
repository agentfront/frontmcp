import type { StructuredLogEntry } from '../logging/structured-log.types';
import type { RequestLog, RequestLogEntry, RequestLogCollectorOptions } from './request-log.types';

/**
 * RequestLogCollector — per-request accumulator for structured log entries.
 *
 * Created once per request (CONTEXT-scoped). Accumulates log entries
 * and metadata, then produces a complete RequestLog on finalize.
 */
export class RequestLogCollector {
  private readonly entries: RequestLogEntry[] = [];
  private readonly hooksTriggered: Set<string> = new Set();
  private readonly maxEntries: number;
  private readonly onComplete?: (log: RequestLog) => void | Promise<void>;

  // Request identity (set at construction)
  private readonly requestId: string;
  private readonly traceId: string;
  private readonly sessionIdHash: string;
  private readonly scopeId: string;
  private readonly startTime: Date;

  // Metadata (set progressively during request lifecycle)
  private httpMethod?: string;
  private httpPath?: string;
  private rpcMethod?: string;
  private toolName?: string;
  private resourceUri?: string;
  private promptName?: string;
  private authType?: string;
  private authenticated = false;
  private status: RequestLog['status'] = 'ok';
  private statusCode?: number;
  private error?: RequestLog['error'];
  private finalized = false;

  constructor(
    context: {
      requestId: string;
      traceId: string;
      sessionIdHash: string;
      scopeId: string;
    },
    options?: RequestLogCollectorOptions,
  ) {
    this.requestId = context.requestId;
    this.traceId = context.traceId;
    this.sessionIdHash = context.sessionIdHash;
    this.scopeId = context.scopeId;
    this.startTime = new Date();
    this.maxEntries = options?.maxEntries ?? 500;
    this.onComplete = options?.onRequestComplete;
  }

  /**
   * Add a structured log entry to this request's log.
   * Called by StructuredLogTransport for each log record that
   * matches this request's requestId.
   */
  addEntry(entry: StructuredLogEntry): void {
    if (this.finalized || this.entries.length >= this.maxEntries) return;

    const logEntry: RequestLogEntry = {
      timestamp: entry.timestamp,
      level: entry.level,
      message: entry.message,
    };

    if (entry.flow_name) {
      logEntry.stage = entry.flow_name;
    }
    if (entry.elapsed_ms !== undefined) {
      logEntry.elapsed_ms = entry.elapsed_ms;
    }
    if (entry.attributes && Object.keys(entry.attributes).length > 0) {
      logEntry.attributes = entry.attributes;
    }

    this.entries.push(logEntry);
  }

  /**
   * Record a hook stage that was triggered during this request.
   */
  addHook(stage: string): void {
    this.hooksTriggered.add(stage);
  }

  /**
   * Set HTTP request metadata.
   */
  setHttpInfo(method: string, path: string): void {
    this.httpMethod = method;
    this.httpPath = path;
  }

  /**
   * Set the MCP JSON-RPC method being invoked.
   */
  setRpcMethod(method: string): void {
    this.rpcMethod = method;
  }

  /**
   * Set the tool name being invoked.
   */
  setToolName(name: string): void {
    this.toolName = name;
  }

  /**
   * Set the resource URI being read.
   */
  setResourceUri(uri: string): void {
    this.resourceUri = uri;
  }

  /**
   * Set the prompt name being invoked.
   */
  setPromptName(name: string): void {
    this.promptName = name;
  }

  /**
   * Set authentication info.
   */
  setAuthInfo(type: string, authenticated: boolean): void {
    this.authType = type;
    this.authenticated = authenticated;
  }

  /**
   * Set request status.
   */
  setStatus(status: RequestLog['status'], statusCode?: number): void {
    this.status = status;
    this.statusCode = statusCode;
  }

  /**
   * Set error details.
   */
  setError(error: RequestLog['error']): void {
    this.error = error;
    this.status = 'error';
  }

  /**
   * Finalize and produce the complete RequestLog.
   * Fires the onRequestComplete callback if configured.
   */
  async finalize(): Promise<RequestLog> {
    if (this.finalized) {
      return this.toRequestLog();
    }
    this.finalized = true;

    const log = this.toRequestLog();

    if (this.onComplete) {
      try {
        await this.onComplete(log);
      } catch {
        // Callback errors must not break the request lifecycle
      }
    }

    return log;
  }

  /**
   * Build the RequestLog object from accumulated state.
   */
  toRequestLog(): RequestLog {
    const endTime = new Date();
    return {
      request_id: this.requestId,
      trace_id: this.traceId,
      session_id_hash: this.sessionIdHash,
      scope_id: this.scopeId,
      start_time: this.startTime.toISOString(),
      end_time: endTime.toISOString(),
      duration_ms: endTime.getTime() - this.startTime.getTime(),
      http_method: this.httpMethod,
      http_path: this.httpPath,
      rpc_method: this.rpcMethod,
      tool_name: this.toolName,
      resource_uri: this.resourceUri,
      prompt_name: this.promptName,
      auth_type: this.authType,
      authenticated: this.authenticated,
      status: this.status,
      status_code: this.statusCode,
      error: this.error,
      hooks_triggered: Array.from(this.hooksTriggered),
      entries: [...this.entries],
    };
  }

  /**
   * Check if the collector has been finalized.
   */
  isFinalized(): boolean {
    return this.finalized;
  }

  /**
   * Get the number of accumulated entries.
   */
  getEntryCount(): number {
    return this.entries.length;
  }
}
