/**
 * Registry-related interfaces for dependency injection.
 */

import type { Token } from './base.interface.js';
import type { ProviderRecord } from '../records/provider.record.js';

/**
 * Interface for the DI container.
 * Provides methods for resolving dependencies.
 */
export interface DiContainerInterface {
  /**
   * Promise that resolves when the container is fully initialized.
   */
  ready: Promise<void>;

  /**
   * Get a GLOBAL-scoped provider by token.
   * Throws if the provider is not registered or is scoped.
   *
   * @param token - The provider token
   * @returns The provider instance
   */
  get<T>(token: Token<T>): T;

  /**
   * Resolve a dependency by token or class.
   * If not registered, attempts to construct the class directly.
   *
   * @param cls - The token or class to resolve
   * @returns The resolved instance
   */
  resolve<T>(cls: Token<T>): T;

  /**
   * Try to get a provider, returning undefined if not found.
   *
   * @param token - The provider token
   * @returns The provider instance or undefined
   */
  tryGet?<T>(token: Token<T>): T | undefined;

  /**
   * Get the scope of a provider record.
   */
  getProviderScope(rec: ProviderRecord): import('../metadata/provider.metadata.js').ProviderScope;

  /**
   * Get all discovered dependencies for a provider record.
   */
  discoveryDeps(rec: ProviderRecord): Token[];

  /**
   * Get all invocation tokens for a provider record.
   */
  invocationTokens(token: Token, rec: ProviderRecord): Token[];
}

/**
 * Views for scoped provider access.
 * Separates GLOBAL singletons from CONTEXT-scoped instances.
 */
export interface DiViews {
  /**
   * GLOBAL-scoped singleton instances.
   * These are shared across all requests.
   */
  global: ReadonlyMap<Token, unknown>;

  /**
   * CONTEXT-scoped instances for this request/session.
   * Built on-demand per request.
   */
  context: Map<Token, unknown>;
}
