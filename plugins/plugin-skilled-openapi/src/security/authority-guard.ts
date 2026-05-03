// file: plugins/plugin-skilled-openapi/src/security/authority-guard.ts
//
// Adapter from the bundle's `requiredAuthorities` policy (a free-form
// Record<string, unknown> at the SDK boundary) into libs/auth's
// AuthoritiesEngine. The plugin owns the engine instance because it has its
// own profile registry (none, in v1.2 — bundles ship inline policies).

import {
  AuthoritiesContextBuilder,
  AuthoritiesEngine,
  AuthoritiesEvaluatorRegistry,
  AuthoritiesProfileRegistry,
  type AuthoritiesEvaluationContext,
  type AuthoritiesMetadata,
  type AuthoritiesResult,
} from '@frontmcp/auth';

import type { AuthoritiesPolicy } from '../bundle/bundle.types';

export interface AuthorityCheckArgs {
  /** Required-authorities policy from the bundle (skill-level + op-level merged). */
  policy: AuthoritiesPolicy | undefined;
  /** Caller authInfo (from MCP request); shape matches libs/auth's AuthInfoLike. */
  authInfo: Partial<{ user?: Record<string, unknown>; extra?: Record<string, unknown> }>;
  /** Tool/action input that ABAC predicates may reference. */
  input: Record<string, unknown>;
  /** Optional environment vars that ABAC predicates may reference. */
  env?: Record<string, unknown>;
}

/**
 * Default permissive guard when no policy is attached. v1.2 ships fail-closed
 * for hidden ops: skill-level policy missing AND op-level policy missing means
 * grant — but the meta-tool layer always requires successful skill resolution
 * and the bundle signature verifies origin trust.
 */
export class AuthorityGuard {
  private readonly engine: AuthoritiesEngine;
  private readonly contextBuilder: AuthoritiesContextBuilder;

  constructor(
    opts: {
      profiles?: AuthoritiesProfileRegistry;
      evaluators?: AuthoritiesEvaluatorRegistry;
    } = {},
  ) {
    const profiles = opts.profiles ?? new AuthoritiesProfileRegistry();
    const evaluators = opts.evaluators ?? new AuthoritiesEvaluatorRegistry();
    this.engine = new AuthoritiesEngine(profiles, evaluators);
    this.contextBuilder = new AuthoritiesContextBuilder();
  }

  async check(args: AuthorityCheckArgs): Promise<AuthoritiesResult> {
    const { policy, authInfo, input, env } = args;
    if (policy === undefined) {
      // No policy → grant (skill-level signed-bundle origin trust is the upstream gate).
      return { granted: true, evaluatedPolicies: [] };
    }
    const ctx: AuthoritiesEvaluationContext = this.contextBuilder.build(authInfo, input, env);
    return this.engine.evaluate(policy as AuthoritiesMetadata, ctx);
  }
}
