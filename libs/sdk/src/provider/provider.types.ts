import { Token } from '@frontmcp/di';

/**
 * Provider instance views for different scopes.
 *
 * The unified context model uses:
 * - global: GLOBAL-scoped singleton providers
 * - context: CONTEXT-scoped providers (per-request/session)
 *
 * For backwards compatibility, `session` and `request` are provided as aliases
 * to `context`. Both point to the same map.
 */
export interface ProviderViews {
  /** App-wide singletons, created at boot. Immutable from invoke's POV. */
  global: ReadonlyMap<Token, unknown>;

  /** Context-scoped providers for this invocation. Unified session+request data. */
  context: Map<Token, unknown>;

  /**
   * @deprecated Use `context` instead. Alias for backwards compatibility.
   * Points to the same map as `context`.
   */
  session: Map<Token, unknown>;

  /**
   * @deprecated Use `context` instead. Alias for backwards compatibility.
   * Points to the same map as `context`.
   */
  request: Map<Token, unknown>;
}
