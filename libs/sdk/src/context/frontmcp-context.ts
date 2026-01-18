/**
 * FrontMcpContext - Unified context for FrontMCP
 *
 * Single point of truth for all request-related data, combining session and request state.
 * Flows through the entire async execution chain via AsyncLocalStorage.
 *
 * Access via DI using the FRONTMCP_CONTEXT token:
 * ```typescript
 * const ctx = this.get(FRONTMCP_CONTEXT);
 * console.log(ctx.requestId, ctx.sessionId, ctx.authInfo);
 * ```
 */

import { randomUUID, sha256Hex } from '@frontmcp/utils';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { FrontMcpLogger } from '../common/interfaces/logger.interface';
import { TraceContext, generateTraceContext } from './trace-context';
import type { SessionIdPayload } from '../common/types';
import { InvalidInputError } from '../errors/mcp.error';
import { ElicitResult, ElicitOptions, ResolvedElicitResult } from '../elicitation';
import { ZodType } from 'zod';

/** Symbol key for storing pre-resolved elicit result in context store */
const PRE_RESOLVED_ELICIT_KEY = Symbol.for('frontmcp:pre-resolved-elicit');

/**
 * Request metadata extracted from HTTP headers.
 */
export interface RequestMetadata {
  /** User-Agent header */
  userAgent?: string;
  /** Content-Type header */
  contentType?: string;
  /** Accept header */
  accept?: string;
  /** Client IP address (from x-forwarded-for or socket) */
  clientIp?: string;
  /** Custom headers matching x-frontmcp-* pattern */
  customHeaders: Record<string, string>;
}

/**
 * Configuration for the context.
 */
export interface FrontMcpContextConfig {
  /** Auto-inject auth headers in fetch requests (default: true) */
  autoInjectAuthHeaders?: boolean;
  /** Auto-inject tracing headers in fetch requests (default: true) */
  autoInjectTracingHeaders?: boolean;
  /** Default fetch request timeout in milliseconds (default: 30000) */
  requestTimeout?: number;
}

/**
 * Arguments for creating a FrontMcpContext.
 */
export interface FrontMcpContextArgs {
  /** Optional request ID (generated if not provided) */
  requestId?: string;
  /** Optional trace context (generated if not provided) */
  traceContext?: TraceContext;
  /** Session identifier (required) */
  sessionId: string;
  /** Authentication information (can be partial, progressively populated) */
  authInfo?: Partial<AuthInfo>;
  /** Scope identifier (required) */
  scopeId: string;
  /** Optional timestamp (defaults to Date.now()) */
  timestamp?: number;
  /** Optional request metadata */
  metadata?: RequestMetadata;
  /** Optional configuration */
  config?: FrontMcpContextConfig;
}

/**
 * Interface for transport access (elicit support).
 * Provides clean API for accessing transport capabilities.
 */
export interface TransportAccessor {
  /**
   * Check if transport supports elicit requests.
   */
  readonly supportsElicit: boolean;

  /**
   * Send an elicit request to the client for interactive input.
   *
   * @param message - Message to display to the user
   * @param requestedSchema - Zod schema for validating the response
   * @param options - Elicit options (mode, ttl, elicitationId)
   * @returns Typed elicit result with status and validated content
   * @throws ElicitationNotSupportedError if client doesn't support elicitation
   * @throws ElicitationTimeoutError if request times out
   */
  elicit<S extends ZodType>(
    message: string,
    requestedSchema: S,
    options?: ElicitOptions,
  ): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>>;
}

// Forward declaration for type reference (avoid circular imports)
type FlowBaseRef = { readonly name: string };
type ScopeRef = { readonly id: string; readonly logger: FrontMcpLogger };
interface TransportRef {
  sendElicitRequest: <S extends ZodType>(
    relatedRequestId: number | string,
    message: string,
    requestedSchema: S,
    options?: ElicitOptions,
  ) => Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>>;
  readonly type: string;
  /** JSON-RPC request ID for this request - used for elicitation routing */
  readonly jsonRpcRequestId?: number | string;
}

/**
 * Session ID validation constants.
 */

/** Maximum allowed length for session IDs */
export const SESSION_ID_MAX_LENGTH = 2048;

/**
 * Valid characters for session IDs:
 * - Alphanumeric (a-z, A-Z, 0-9)
 * - Hyphen, underscore, period
 * - Colon (for namespaced IDs like "anon:uuid")
 */
export const SESSION_ID_VALID_PATTERN = /^[a-zA-Z0-9\-_.:]+$/;

/**
 * Validate a session ID string.
 *
 * Validates:
 * - Not empty
 * - Maximum length (2048 characters)
 * - Valid characters only (alphanumeric, hyphen, underscore, period, colon)
 *
 * @param value - The session ID to validate
 * @throws InvalidInputError if validation fails (empty, too long, invalid characters)
 */
export function validateSessionId(value: string): void {
  if (!value || value.length === 0) {
    throw new InvalidInputError('Session ID cannot be empty');
  }
  if (value.length > SESSION_ID_MAX_LENGTH) {
    throw new InvalidInputError(`Session ID exceeds maximum length of ${SESSION_ID_MAX_LENGTH} characters`);
  }
  if (!SESSION_ID_VALID_PATTERN.test(value)) {
    throw new InvalidInputError(
      'Session ID contains invalid characters. Allowed: alphanumeric, hyphen, underscore, period, colon',
    );
  }
}

/**
 * FrontMcpContext - Unified context for FrontMCP
 *
 * Provides a single point of truth for all request-related data:
 * - Identity: requestId, sessionId, scopeId
 * - Tracing: W3C trace context
 * - Auth: authentication information (progressively populated)
 * - References: transport, flow, scope (pointers, not copies)
 * - Store: key/value storage for context-scoped data
 * - Fetch: context-aware fetch with auto-injection
 */
export class FrontMcpContext {
  // =====================
  // Identity
  // =====================

  /** Unique request identifier (UUID v4) */
  readonly requestId: string;

  /** Session identifier (validated) */
  readonly sessionId: string;

  /** Scope identifier */
  readonly scopeId: string;

  // =====================
  // Tracing
  // =====================

  /** W3C Trace Context or generated trace ID */
  readonly traceContext: TraceContext;

  /** Request start timestamp */
  readonly timestamp: number;

  // =====================
  // Configuration
  // =====================

  /** Context configuration */
  readonly config: FrontMcpContextConfig;

  // =====================
  // Metadata
  // =====================

  /** Request metadata (headers, user-agent, etc.) */
  readonly metadata: RequestMetadata;

  // =====================
  // Auth (mutable, progressively populated)
  // =====================

  private _authInfo: Partial<AuthInfo>;
  private _sessionMetadata?: SessionIdPayload;

  // =====================
  // References (pointers)
  // =====================

  private _transport?: TransportRef;
  private _flow?: FlowBaseRef;
  private _scope?: ScopeRef;

  // =====================
  // Storage
  // =====================

  private readonly marks: Map<string, number> = new Map();
  private readonly store: Map<string | symbol, unknown> = new Map();

  constructor(args: FrontMcpContextArgs) {
    // Validate session ID
    validateSessionId(args.sessionId);

    this.requestId = args.requestId ?? randomUUID();
    this.sessionId = args.sessionId;
    this.scopeId = args.scopeId;
    this.traceContext = args.traceContext ?? generateTraceContext();
    this.timestamp = args.timestamp ?? Date.now();
    this._authInfo = args.authInfo ?? {};

    // Configuration with defaults
    this.config = {
      autoInjectAuthHeaders: args.config?.autoInjectAuthHeaders ?? true,
      autoInjectTracingHeaders: args.config?.autoInjectTracingHeaders ?? true,
      requestTimeout: args.config?.requestTimeout ?? 30000,
    };

    // Defensive normalization: ensure customHeaders is always an object
    const metadata = args.metadata;
    this.metadata = {
      ...metadata,
      customHeaders: metadata?.customHeaders ?? {},
    };

    // Initial mark
    this.marks.set('init', this.timestamp);
  }

  // =====================
  // Auth Accessors
  // =====================

  /**
   * Get authentication information.
   * Returns Partial<AuthInfo> because auth info is progressively populated.
   */
  get authInfo(): Partial<AuthInfo> {
    return this._authInfo;
  }

  /**
   * Update auth info after authorization is verified.
   * Can be called multiple times to progressively add fields.
   *
   * @param authInfo - The auth info fields to set/update
   * @internal
   */
  updateAuthInfo(authInfo: Partial<AuthInfo>): void {
    this._authInfo = { ...this._authInfo, ...authInfo };
  }

  /**
   * Get session metadata (protocol, platform type, node info).
   * Only available after session verification.
   */
  get sessionMetadata(): SessionIdPayload | undefined {
    return this._sessionMetadata;
  }

  /**
   * Update session metadata after session verification.
   *
   * @param metadata - Session metadata from verified session
   * @internal
   */
  updateSessionMetadata(metadata: SessionIdPayload): void {
    this._sessionMetadata = metadata;
  }

  // =====================
  // Reference Accessors
  // =====================

  /**
   * Get transport accessor for elicit support.
   * Returns undefined if no transport is registered.
   */
  get transport(): TransportAccessor | undefined {
    if (!this._transport) return undefined;
    const transportRef = this._transport;
    return {
      // TODO: Consider deriving supportsElicit from transport capabilities
      // instead of hardcoding true when transport is available
      supportsElicit: true,
      elicit: (message, schema, options) => {
        // Use the JSON-RPC request ID from the transport for proper stream routing
        // The MCP SDK uses this to route elicitation requests through the correct SSE stream
        const relatedRequestId = transportRef.jsonRpcRequestId;
        if (relatedRequestId === undefined) {
          this._scope?.logger.warn('[FrontMcpContext] Elicit called without jsonRpcRequestId, using fallback ID 0');
        }
        return transportRef.sendElicitRequest(relatedRequestId ?? 0, message, schema, options);
      },
    };
  }

  /**
   * Set transport reference (internal use).
   * @internal
   */
  setTransport(transport: TransportRef): void {
    this._transport = transport;
  }

  /**
   * Get current flow reference.
   */
  get flow(): FlowBaseRef | undefined {
    return this._flow;
  }

  /**
   * Set flow reference (internal use).
   * @internal
   */
  setFlow(flow: FlowBaseRef): void {
    this._flow = flow;
  }

  /**
   * Get scope reference.
   */
  get scope(): ScopeRef | undefined {
    return this._scope;
  }

  /**
   * Set scope reference (internal use).
   * @internal
   */
  setScope(scope: ScopeRef): void {
    this._scope = scope;
  }

  // =====================
  // Store Operations
  // =====================

  /**
   * Store context-scoped data.
   *
   * @param key - Storage key
   * @param value - Value to store
   */
  set<T>(key: string | symbol, value: T): void {
    this.store.set(key, value);
  }

  /**
   * Retrieve context-scoped data.
   *
   * @param key - Storage key
   * @returns Stored value or undefined
   */
  get<T>(key: string | symbol): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /**
   * Check if a key exists in the context store.
   *
   * @param key - Storage key
   * @returns True if key exists
   */
  has(key: string | symbol): boolean {
    return this.store.has(key);
  }

  /**
   * Delete a key from the context store.
   *
   * @param key - Storage key
   * @returns True if key was deleted
   */
  delete(key: string | symbol): boolean {
    return this.store.delete(key);
  }

  // =====================
  // Pre-Resolved Elicit
  // =====================

  /**
   * Set a pre-resolved elicit result for fallback continuation.
   *
   * Used when sendElicitationResult is called to re-invoke the original tool
   * with the user's response already available. The tool's elicit() call will
   * return this result immediately instead of making a new elicit request.
   *
   * @param result - The elicit result from the user
   * @internal
   */
  setPreResolvedElicitResult(result: ElicitResult<unknown>): void {
    this.store.set(PRE_RESOLVED_ELICIT_KEY, result);
  }

  /**
   * Get the pre-resolved elicit result, if any.
   *
   * Called by elicit() to check if a result was pre-resolved (fallback continuation).
   *
   * @returns The pre-resolved result, or undefined if not set
   * @internal
   */
  getPreResolvedElicitResult(): ElicitResult<unknown> | undefined {
    return this.store.get(PRE_RESOLVED_ELICIT_KEY) as ElicitResult<unknown> | undefined;
  }

  /**
   * Clear the pre-resolved elicit result.
   *
   * Called after the result has been consumed to prevent it from being used again.
   *
   * @internal
   */
  clearPreResolvedElicitResult(): void {
    this.store.delete(PRE_RESOLVED_ELICIT_KEY);
  }

  // =====================
  // Timing & Performance
  // =====================

  /**
   * Mark a timing point for performance tracking.
   *
   * @param name - Name of the timing mark
   */
  mark(name: string): void {
    this.marks.set(name, Date.now());
  }

  /**
   * Get elapsed time in milliseconds between two marks.
   *
   * @param from - Start mark name (defaults to 'init')
   * @param to - End mark name (defaults to current time)
   * @returns Elapsed time in milliseconds
   */
  elapsed(from?: string, to?: string): number {
    const fromTime = this.marks.get(from ?? 'init') ?? this.timestamp;
    const toTime = to ? (this.marks.get(to) ?? Date.now()) : Date.now();
    return toTime - fromTime;
  }

  /**
   * Get all timing marks.
   *
   * @returns Read-only map of mark names to timestamps
   */
  getMarks(): ReadonlyMap<string, number> {
    return this.marks;
  }

  // =====================
  // Logging
  // =====================

  /**
   * Get a child logger with context attached.
   *
   * Creates a child logger with a prefix containing the request ID and trace ID
   * for easy request tracing in logs.
   *
   * @param parentLogger - The parent logger to create a child from
   * @returns A logger with requestId and traceId in the prefix
   */
  getLogger(parentLogger: FrontMcpLogger): FrontMcpLogger {
    const prefix = `[${this.requestId.slice(0, 8)}:${this.traceContext.traceId.slice(0, 8)}]`;
    return parentLogger.child(prefix);
  }

  /**
   * Get a summary of the context for logging.
   *
   * Note: sessionId is hashed to prevent accidental exposure of user-identifying
   * session identifiers in logs while still allowing correlation.
   *
   * @returns Object with key context fields
   */
  toLogContext(): Record<string, unknown> {
    return {
      requestId: this.requestId,
      traceId: this.traceContext.traceId,
      parentId: this.traceContext.parentId,
      // Hash sessionId to prevent logging user-identifying information
      sessionIdHash: sha256Hex(this.sessionId).slice(0, 12),
      scopeId: this.scopeId,
      flowName: this._flow?.name,
      elapsed: this.elapsed(),
    };
  }

  // =====================
  // Context-Aware Fetch
  // =====================

  /**
   * Perform a fetch request with automatic header injection.
   *
   * Injects:
   * - Authorization header (if authInfo.token is available and autoInjectAuthHeaders is true)
   * - W3C traceparent header (if autoInjectTracingHeaders is true)
   * - x-request-id header
   * - Custom headers from request metadata
   *
   * @param input - Request URL or Request object
   * @param init - Request options
   * @returns Fetch response
   */
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);

    // Auto-inject auth headers
    if (this.config.autoInjectAuthHeaders && this._authInfo.token) {
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${this._authInfo.token}`);
      }
    }

    // Auto-inject tracing headers
    if (this.config.autoInjectTracingHeaders) {
      if (!headers.has('traceparent')) {
        headers.set('traceparent', this.traceContext.raw);
      }
      if (!headers.has('x-request-id')) {
        headers.set('x-request-id', this.requestId);
      }
    }

    // Inject custom headers from request metadata
    for (const [key, value] of Object.entries(this.metadata.customHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }

    // Use AbortSignal.timeout if no signal provided
    const signal = init?.signal ?? AbortSignal.timeout(this.config.requestTimeout ?? 30000);

    return fetch(input, {
      ...init,
      headers,
      signal,
    });
  }
}

/**
 * Alias for FrontMcpContext.
 * Use when you want a shorter name.
 */
export { FrontMcpContext as Context };
