/**
 * RequestContext - Production-ready request context for FrontMCP
 *
 * Provides request-scoped state that flows through the entire async execution
 * chain via AsyncLocalStorage. Access via DI only using the REQUEST_CONTEXT token.
 */

import { randomUUID, sha256Hex } from '@frontmcp/utils';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { FrontMcpLogger } from '../common/interfaces/logger.interface';
import { TraceContext, generateTraceContext } from './trace-context';
import type { SessionIdPayload } from '../common/types';

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
 * Arguments for creating a RequestContext.
 */
export interface RequestContextArgs {
  /** Optional request ID (generated if not provided) */
  requestId?: string;
  /** Optional trace context (generated if not provided) */
  traceContext?: TraceContext;
  /** Session identifier (required) */
  sessionId: string;
  /** Authentication information (can be partial, progressively populated) */
  authInfo: Partial<AuthInfo>;
  /** Scope identifier (required) */
  scopeId: string;
  /** Optional timestamp (defaults to Date.now()) */
  timestamp?: number;
  /** Optional request metadata */
  metadata?: RequestMetadata;
}

/**
 * RequestContext provides per-request state that flows through
 * the entire async execution chain via AsyncLocalStorage.
 *
 * Access via DI only using the REQUEST_CONTEXT token:
 * ```typescript
 * const ctx = this.get(REQUEST_CONTEXT);
 * console.log(ctx.requestId, ctx.traceContext.traceId);
 * ```
 */
export class RequestContext {
  /** Unique request identifier (UUID v4) */
  readonly requestId: string;

  /** W3C Trace Context or generated trace ID */
  readonly traceContext: TraceContext;

  /** Session identifier (from mcp-session-id header or authorization) */
  readonly sessionId: string;

  /**
   * Authentication information.
   * Note: This is mutable to allow updating after authorization is verified.
   * It's Partial<AuthInfo> because auth info is progressively populated
   * throughout the request lifecycle (some fields like transport are only
   * available after the transport is established).
   */
  private _authInfo: Partial<AuthInfo>;

  /** Scope identifier */
  readonly scopeId: string;

  /** Request start timestamp */
  readonly timestamp: number;

  /** Request metadata (headers, user-agent, etc.) */
  readonly metadata: RequestMetadata;

  /** Timing marks for performance tracking */
  private readonly marks: Map<string, number> = new Map();

  /** Request-scoped data store */
  private readonly store: Map<string | symbol, unknown> = new Map();

  constructor(args: RequestContextArgs) {
    this.requestId = args.requestId ?? randomUUID();
    this.traceContext = args.traceContext ?? generateTraceContext();
    this.sessionId = args.sessionId;
    this._authInfo = args.authInfo;
    this.scopeId = args.scopeId;
    this.timestamp = args.timestamp ?? Date.now();
    // Defensive normalization: ensure customHeaders is always an object
    // even if args.metadata is partially defined at runtime (TS can't enforce this)
    const metadata = args.metadata;
    this.metadata = {
      ...metadata,
      customHeaders: metadata?.customHeaders ?? {},
    };

    // Initial mark
    this.marks.set('init', this.timestamp);
  }

  /**
   * Get authentication information.
   * Returns Partial<AuthInfo> because auth info is progressively populated.
   */
  get authInfo(): Partial<AuthInfo> {
    return this._authInfo;
  }

  /**
   * Update auth info after authorization is verified.
   * Called by checkAuthorization stage after session verification.
   * Can be called multiple times to progressively add fields.
   *
   * @param authInfo - The auth info fields to set/update
   * @internal
   */
  updateAuthInfo(authInfo: Partial<AuthInfo>): void {
    // Merge with existing auth info to support progressive updates
    this._authInfo = { ...this._authInfo, ...authInfo };
  }

  /**
   * Session metadata including protocol, platform type, and node info.
   * Only available after session verification in authenticated flows.
   */
  private _sessionMetadata?: SessionIdPayload;

  /**
   * Get session metadata.
   *
   * Contains protocol type, platform type, nodeId, and authSignature.
   * Only available after session verification completes.
   *
   * @returns Session metadata or undefined if not yet verified
   */
  get sessionMetadata(): SessionIdPayload | undefined {
    return this._sessionMetadata;
  }

  /**
   * Update session metadata after session verification.
   * Called by checkAuthorization stage after session verification.
   *
   * @param metadata - Session metadata from verified session
   * @internal
   */
  updateSessionMetadata(metadata: SessionIdPayload): void {
    this._sessionMetadata = metadata;
  }

  /**
   * Get a child logger with request context attached.
   *
   * Creates a child logger with a prefix containing the request ID and trace ID
   * for easy request tracing in logs.
   *
   * @param parentLogger - The parent logger to create a child from
   * @returns A logger with requestId and traceId in the prefix
   */
  getLogger(parentLogger: FrontMcpLogger): FrontMcpLogger {
    // FrontMcpLogger.child() takes a string prefix
    const prefix = `[${this.requestId.slice(0, 8)}:${this.traceContext.traceId.slice(0, 8)}]`;
    return parentLogger.child(prefix);
  }

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
    const toTime = to ? this.marks.get(to) ?? Date.now() : Date.now();
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

  /**
   * Store request-scoped data.
   *
   * @param key - Storage key
   * @param value - Value to store
   */
  set<T>(key: string | symbol, value: T): void {
    this.store.set(key, value);
  }

  /**
   * Retrieve request-scoped data.
   *
   * @param key - Storage key
   * @returns Stored value or undefined
   */
  get<T>(key: string | symbol): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /**
   * Check if a key exists in the request-scoped store.
   *
   * @param key - Storage key
   * @returns True if key exists
   */
  has(key: string | symbol): boolean {
    return this.store.has(key);
  }

  /**
   * Delete a key from the request-scoped store.
   *
   * @param key - Storage key
   * @returns True if key was deleted
   */
  delete(key: string | symbol): boolean {
    return this.store.delete(key);
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
      // while preserving ability to correlate logs for the same session
      sessionIdHash: sha256Hex(this.sessionId).slice(0, 12),
      scopeId: this.scopeId,
      elapsed: this.elapsed(),
    };
  }
}
