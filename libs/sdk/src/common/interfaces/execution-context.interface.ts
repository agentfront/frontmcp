// file: libs/sdk/src/common/interfaces/execution-context.interface.ts

import { randomUUID } from 'crypto';
import { Token } from './base.interface';
import { ProviderRegistryInterface } from './internal';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { URL } from 'url';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ScopeEntry } from '../entries';
import { RequestContext, REQUEST_CONTEXT } from '../../context';
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
   * @deprecated Use `requestContext.authInfo` instead. Will be removed in v2.0.
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
   * Get the current request context.
   *
   * Provides access to requestId, traceId, sessionId, authInfo,
   * timing marks, and request metadata.
   *
   * @throws RequestContextNotAvailableError if called outside of a request scope
   */
  get requestContext(): RequestContext {
    try {
      return this.providers.get(REQUEST_CONTEXT as Token<RequestContext>);
    } catch {
      // Fallback: request context not available, likely called during initialization
      throw new RequestContextNotAvailableError();
    }
  }

  /**
   * Try to get the request context, returning undefined if not available.
   *
   * Use this when request context may not be available (e.g., during initialization).
   */
  tryGetRequestContext(): RequestContext | undefined {
    try {
      return this.providers.get(REQUEST_CONTEXT as Token<RequestContext>);
    } catch {
      return undefined;
    }
  }

  /**
   * @deprecated Use `requestContext.authInfo` instead. Will be removed in v2.0.
   *
   * Get authentication information for the current request.
   */
  get authInfo(): Partial<AuthInfo> {
    return this._authInfo;
  }

  /**
   * Get authentication information for the current request.
   *
   * Prefers requestContext.authInfo when available (the recommended source),
   * falls back to the legacy authInfo property for backward compatibility.
   *
   * Returns Partial<AuthInfo> because auth info is progressively populated
   * during the request lifecycle. Callers should check for required fields.
   */
  getAuthInfo(): Partial<AuthInfo> {
    const requestCtx = this.tryGetRequestContext();
    if (requestCtx) {
      return requestCtx.authInfo;
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
      return this.requestContext.getLogger(this.logger);
    } catch {
      // Fallback if request context not available
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
   * Fetch a URL using the standard fetch API.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  /**
   * Get the current error, if any.
   */
  protected get error(): Error | undefined {
    return this._error;
  }
}
