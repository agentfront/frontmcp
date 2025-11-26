// file: libs/sdk/src/common/interfaces/execution-context.interface.ts

import { randomUUID } from 'crypto';
import { Token } from './base.interface';
import { ProviderRegistryInterface } from './internal';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { URL } from 'url';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ScopeEntry } from '../entries';

/**
 * Base constructor arguments for all execution contexts.
 */
export type ExecutionContextBaseArgs = {
  providers: ProviderRegistryInterface;
  logger: FrontMcpLogger;
  authInfo: AuthInfo;
};

/**
 * Abstract base class for execution contexts (tools, resources, prompts, etc.).
 * Provides common functionality for dependency injection, logging, and flow control.
 */
export abstract class ExecutionContextBase<Out = any> {
  private providers: ProviderRegistryInterface;
  readonly authInfo: AuthInfo;

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
    this.authInfo = authInfo;
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
