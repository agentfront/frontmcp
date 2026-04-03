/**
 * Request Log — per-request aggregated view of all events
 * during a request lifecycle.
 */

/**
 * Single entry within a request log.
 */
export interface RequestLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** Log level */
  level: string;

  /** Log message */
  message: string;

  /** Flow stage that produced the entry */
  stage?: string;

  /** Elapsed time since request start (ms) */
  elapsed_ms?: number;

  /** Additional structured attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Complete request log — aggregated view of a single request lifecycle.
 */
export interface RequestLog {
  // ── Identity ──
  /** Unique request identifier */
  request_id: string;

  /** W3C trace ID */
  trace_id: string;

  /** SHA-256 truncated session ID */
  session_id_hash: string;

  /** Scope identifier */
  scope_id: string;

  // ── Timing ──
  /** ISO 8601 start time */
  start_time: string;

  /** ISO 8601 end time */
  end_time: string;

  /** Total duration in milliseconds */
  duration_ms: number;

  // ── What was invoked ──
  /** HTTP method (GET, POST, etc.) */
  http_method?: string;

  /** URL path */
  http_path?: string;

  /** MCP JSON-RPC method (e.g., "tools/call", "resources/read") */
  rpc_method?: string;

  // ── Component details ──
  /** Tool name (for tools/call requests) */
  tool_name?: string;

  /** Resource URI (for resources/read requests) */
  resource_uri?: string;

  /** Prompt name (for prompts/get requests) */
  prompt_name?: string;

  // ── Auth ──
  /** Authentication type used */
  auth_type?: string;

  /** Whether the request was authenticated */
  authenticated: boolean;

  // ── Status ──
  /** Overall request status */
  status: 'ok' | 'error' | 'aborted' | 'rate_limited';

  /** HTTP response status code */
  status_code?: number;

  /** Error details (if status = 'error') */
  error?: {
    type: string;
    message: string;
    code?: string;
    error_id?: string;
  };

  // ── Observability ──
  /** Hook stages that were triggered during this request */
  hooks_triggered: string[];

  /** All structured log entries for this request */
  entries: RequestLogEntry[];
}

/**
 * Options for RequestLogCollector.
 */
export interface RequestLogCollectorOptions {
  /** Maximum entries to collect per request (default: 500) */
  maxEntries?: number;

  /** Include input/output summaries (default: true) */
  includeSummaries?: boolean;

  /** Callback when request log is complete */
  onRequestComplete?: (log: RequestLog) => void | Promise<void>;
}
