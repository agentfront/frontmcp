import { Token } from '@frontmcp/sdk';

export interface ProviderViews {
  /** App-wide singletons, created at boot. Immutable from invoke’s POV. */
  global: ReadonlyMap<Token, unknown>;
  /** Session-scoped cache for this sessionId. Mutable. */
  session: Map<Token, unknown>;
  /** Request-scoped providers for this single invocation. Mutable. */
  request: Map<Token, unknown>;
}
