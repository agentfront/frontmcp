import { Token } from '@frontmcp/di';

/**
 * Provider instance views for different scopes.
 *
 * The unified context model uses:
 * - global: GLOBAL-scoped singleton providers
 * - context: CONTEXT-scoped providers (per-request/session)
 */
export interface ProviderViews {
  /** App-wide singletons, created at boot. Immutable from invoke's POV. */
  global: ReadonlyMap<Token, unknown>;

  /** Context-scoped providers for this invocation. Unified session+request data. */
  context: Map<Token, unknown>;
}
