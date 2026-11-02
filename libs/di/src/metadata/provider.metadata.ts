/**
 * Provider metadata types and scope definitions.
 */

/**
 * Provider lifetime scope semantics.
 *
 * - GLOBAL: Singleton, shared across all requests
 * - CONTEXT: Per-context instance (combines session + request data)
 * - SESSION: deprecated Use CONTEXT instead
 * - REQUEST: deprecated Use CONTEXT instead
 */
export enum ProviderScope {
  /** Singleton, shared across all requests */
  GLOBAL = 'global',
  /** Per-context instance (unified session + request scope) */
  CONTEXT = 'context',
  /**
   * @deprecated Use CONTEXT instead. Maps to CONTEXT internally.
   */
  SESSION = 'session',
  /**
   * @deprecated Use CONTEXT instead. Maps to CONTEXT internally.
   */
  REQUEST = 'request',
}

/**
 * Declarative metadata describing a provider.
 */
export interface ProviderMetadata {
  /**
   * Unique identifier for the provider.
   */
  id?: string;

  /**
   * Human-readable name for the provider.
   * @default the token's name: the class name, the symbol's description or the string token
   */
  name?: string;

  /**
   * Optional description of what the provider does.
   */
  description?: string;

  /**
   * Lifetime scope for the provider.
   * @default ProviderScope.GLOBAL
   */
  scope?: ProviderScope;
}
