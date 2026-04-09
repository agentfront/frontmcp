// file: libs/sdk/src/common/interfaces/execution-context.interface.ts

import { type FrontMcpAuthContext, type FrontMcpFetchInit } from '@frontmcp/auth';
import { type Token } from '@frontmcp/di';
import { type AuthInfo } from '@frontmcp/protocol';
import { getRuntimeContext, randomUUID, type RuntimeContext } from '@frontmcp/utils';

import { ConfigService } from '../../builtin/config/providers/config.service';
import { FRONTMCP_CONTEXT, type FrontMcpContext } from '../../context';
import { RequestContextNotAvailableError } from '../../errors/mcp.error';
import { type ScopeEntry } from '../entries';
import { FlowControl } from './flow.interface';
import { type ProviderRegistryInterface } from './internal';
import { type FrontMcpLogger } from './logger.interface';

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

  /** Cached auth context (built lazily on first access) */
  private _authContext?: FrontMcpAuthContext;

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
      return this.providers.get(FRONTMCP_CONTEXT);
    } catch {
      // Context not available (likely called during initialization or outside request scope)
      throw new RequestContextNotAvailableError();
    }
  }

  /**
   * Get the FrontMcpAuthContext for the current request.
   *
   * Provides typed access to user identity, roles, permissions, scopes,
   * and convenience methods like `hasRole()`, `hasPermission()`, `hasScope()`.
   *
   * Custom fields from `ExtendFrontMcpAuthContext` are available if pipes
   * are configured in `@FrontMcp({ authorities: { pipes } })`.
   *
   * @example
   * ```typescript
   * if (!this.auth.hasRole('admin')) throw new Error('Admin required');
   * const tenantId = this.auth.claims['tenantId'];
   * ```
   */
  get auth(): FrontMcpAuthContext {
    if (this._authContext) return this._authContext;

    const rawAuth = require('@frontmcp/auth');
    const auth = (rawAuth.default ?? rawAuth) as typeof import('@frontmcp/auth');
    this._authContext = auth.buildAuthContext(this._authInfo);
    return this._authContext;
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
  fetch(input: RequestInfo | URL, init?: FrontMcpFetchInit | RequestInit): Promise<Response> {
    const ctx = this.tryGetContext();
    if (ctx) {
      return ctx.fetch(input, init);
    }
    // Fallback: no context available — use standard fetch (no credential injection)
    return fetch(input, init as RequestInit);
  }

  /**
   * Get the current error, if any.
   */
  protected get error(): Error | undefined {
    return this._error;
  }

  /**
   * Get the ConfigService for typed environment variable access.
   *
   * Available when ConfigPlugin is installed. Provides methods like:
   * - get(key, defaultValue?) - Get env var with optional default
   * - getRequired(key) - Get required env var (throws if missing)
   * - getNumber(key, defaultValue?) - Get as number
   * - getBoolean(key, defaultValue?) - Get as boolean
   * - has(key) - Check if env var exists
   *
   * @throws Error if ConfigPlugin is not installed
   */
  get config(): ConfigService {
    // ConfigService class serves as its own DI token; cast needed for type compatibility
    return this.providers.get(ConfigService as unknown as Token<ConfigService>);
  }

  // ---- Runtime context helpers ----

  /**
   * Get the current runtime context (platform, runtime, deployment, env).
   */
  get runtimeContext(): RuntimeContext {
    return getRuntimeContext();
  }

  /**
   * Check if running on a specific OS platform.
   * @param platform - 'darwin' (macOS), 'linux', 'win32' (Windows), etc.
   */
  isPlatform(platform: RuntimeContext['platform']): boolean {
    return this.runtimeContext.platform === platform;
  }

  /**
   * Check if running in a specific JavaScript runtime.
   * @param runtime - 'node', 'browser', 'edge', 'bun', 'deno'
   */
  isRuntime(runtime: RuntimeContext['runtime']): boolean {
    return this.runtimeContext.runtime === runtime;
  }

  /**
   * Check if running in a specific deployment mode.
   * @param deployment - 'serverless' or 'standalone'
   */
  isDeployment(deployment: RuntimeContext['deployment']): boolean {
    return this.runtimeContext.deployment === deployment;
  }

  /**
   * Check if running in a specific environment.
   * @param env - 'production', 'development', 'test', etc.
   */
  isEnv(env: RuntimeContext['env']): boolean {
    return this.runtimeContext.env === env;
  }
}
