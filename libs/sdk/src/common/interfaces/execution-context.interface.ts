// file: libs/sdk/src/common/interfaces/execution-context.interface.ts

import { randomUUID } from 'crypto';
import { Token } from './base.interface';
import { ProviderRegistryInterface } from './internal';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { URL } from 'url';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ScopeEntry } from '../entries';
import { FrontMcpContext, FRONTMCP_CONTEXT } from '../../context';
import { RequestContextNotAvailableError } from '../../errors/mcp.error';

/**
 * Base constructor arguments for all execution contexts.
 */
export type ExecutionContextBaseArgs = {
  providers: ProviderRegistryInterface;
  logger: FrontMcpLogger;
  authInfo: Partial<AuthInfo>;
};

/**
 * Abstract base class for execution contexts (tools, resources, prompts, etc.).
 * Provides common functionality for dependency injection, logging, and flow control.
 */
export abstract class ExecutionContextBase<Out = unknown> {
  private providers: ProviderRegistryInterface;

  /**
   * @deprecated Use `context.authInfo` instead. Will be removed in v2.0.
   */
  private readonly _authInfo: Partial<AuthInfo>;

  /** Unique identifier for this execution run */
  protected readonly runId: string;
  protected readonly logger: FrontMcpLogger;

  /** Current stage name for tracking/debugging */
  protected activeStage = 'init';

  /** Error if execution failed */
  private _error?: Error;

  constructor(args: ExecutionContextBaseArgs) {
    const { providers, logger, authInfo } = args;
    this.runId = randomUUID();
    this.providers = providers;
    this.logger = logger;
    this._authInfo = authInfo;
  }

  /**
   * Get the current FrontMcpContext.
   *
   * Provides access to requestId, traceId, sessionId, authInfo,
   * timing marks, request metadata, transport, and context-aware fetch.
   *
   * @throws RequestContextNotAvailableError if called outside of a context scope
   */
  get context(): FrontMcpContext {
    try {
      return this.providers.get(FRONTMCP_CONTEXT as Token<FrontMcpContext>);
    } catch {
      // Context not available (likely called during initialization or outside request scope)
      throw new RequestContextNotAvailableError();
    }
  }

  /**
   * Try to get the context, returning undefined if not available.
   *
   * Use this when context may not be available (e.g., during initialization).
   */
  tryGetContext(): FrontMcpContext | undefined {
    try {
      return this.providers.get(FRONTMCP_CONTEXT as Token<FrontMcpContext>);
    } catch {
      return undefined;
    }
  }

  /**
   * @deprecated Use `context.authInfo` instead. Will be removed in v2.0.
   *
   * Get authentication information for the current request.
   */
  get authInfo(): Partial<AuthInfo> {
    return this._authInfo;
  }

  /**
   * Get authentication information for the current request.
   *
   * Prefers context.authInfo when available (the recommended source),
   * falls back to the legacy authInfo property for backward compatibility.
   *
   * Returns Partial<AuthInfo> because auth info is progressively populated
   * during the request lifecycle. Callers should check for required fields.
   */
  getAuthInfo(): Partial<AuthInfo> {
    const ctx = this.tryGetContext();
    if (ctx) {
      return ctx.authInfo;
    }
    return this._authInfo;
  }

  /**
   * Get a child logger with request context attached.
   *
   * The logger includes requestId, traceId, and sessionId in its context.
   */
  protected get contextLogger(): FrontMcpLogger {
    try {
      return this.context.getLogger(this.logger);
    } catch {
      // Fallback if context not available
      return this.logger;
    }
  }

  /**
   * Get a dependency from the provider registry.
   * @throws Error if the dependency is not found
   */
  get<T>(token: Token<T>): T {
    return this.providers.get(token);
  }

  /**
   * Get the current scope.
   */
  get scope(): ScopeEntry {
    return this.providers.getScope();
  }

  /**
   * Try to get a dependency, returning undefined if not found.
   */
  tryGet<T>(token: Token<T>): T | undefined {
    try {
      return this.providers.get(token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to get provider ${String(token)}: ${msg}`);
      return undefined;
    }
  }

  /**
   * Fail the execution and trigger error handling.
   */
  protected fail(err: Error): never {
    this._error = err;
    FlowControl.fail(err);
  }

  /**
   * Mark the current execution stage (for debugging/tracking).
   */
  mark(stage: string): void {
    this.activeStage = stage;
  }

  /**
   * Fetch a URL with context-aware header injection.
   *
   * When FrontMcpContext is available, delegates to ctx.fetch() which:
   * - Auto-injects Authorization header (if authInfo.token is available)
   * - Auto-injects W3C traceparent header for distributed tracing
   * - Auto-injects x-request-id header
   * - Auto-injects custom headers from request metadata
   *
   * Falls back to standard fetch if context is not available.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const ctx = this.tryGetContext();
    if (ctx) {
      return ctx.fetch(input, init);
    }
    return fetch(input, init);
  }

  /**
   * Get the current error, if any.
   */
  protected get error(): Error | undefined {
    return this._error;
  }
}
