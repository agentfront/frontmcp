// file: plugins/plugin-skilled-openapi/src/security/authority-guard.ts
//
// Adapter from the bundle's `requiredAuthorities` policy (a free-form
// Record<string, unknown> at the SDK boundary) into libs/auth's
// AuthoritiesEngine. The plugin owns the engine instance because it has its
// own profile registry (none, in v1.2 — bundles ship inline policies).

import type { AuthoritiesPolicy } from '@frontmcp/adapters/skills';
import {
  AuthoritiesContextBuilder,
  AuthoritiesEngine,
  AuthoritiesEvaluatorRegistry,
  AuthoritiesProfileRegistry,
  type AuthoritiesEvaluationContext,
  type AuthoritiesMetadata,
  type AuthoritiesResult,
} from '@frontmcp/auth';
import type { FrontMcpLogger } from '@frontmcp/sdk';

/** How an op with NO authorities policy at all is treated by {@link AuthorityGuard}. */
export type UnprotectedOpsPolicy = 'allow' | 'deny';

export interface AuthorityCheckArgs {
  /** Op-level required-authorities policy from the bundle (`OperationDescriptor.requiredAuthorities`). */
  policy: AuthoritiesPolicy | undefined;
  /**
   * Skill-level required-authorities policy (`BundledSkill.requiredAuthorities`).
   * AND-ed with the op-level policy: BOTH must grant. Previously this was
   * silently dropped (C2) — only op-level policy was enforced, so a bundle that
   * gated a whole skill at the skill level left every op of that skill open.
   */
  skillPolicy?: AuthoritiesPolicy | undefined;
  /**
   * Whether the op is explicitly marked public by the bundle
   * (`OperationDescriptor.public === true`). Only consulted when there is NO
   * policy at all AND `unprotectedOps === 'deny'` — it is the bundle's opt-in
   * acknowledgement that a policy-less op is intentionally callable by anyone.
   */
  isPublic?: boolean;
  /**
   * How to treat ops that carry NO policy (neither skill- nor op-level):
   * - `'allow'` (default, backward compatible): grant — origin trust comes from
   *   the signed bundle.
   * - `'deny'`: default-deny the execution surface (C1/C3) — a policy-less op is
   *   blocked unless it is explicitly `public: true`. Production deployments
   *   should set this so a single missing policy line can't silently expose an op.
   */
  unprotectedOps?: UnprotectedOpsPolicy;
  /** Caller authInfo (from MCP request); shape matches libs/auth's AuthInfoLike. */
  authInfo: Partial<{ user?: Record<string, unknown>; extra?: Record<string, unknown> }>;
  /** Tool/action input that ABAC predicates may reference. */
  input: Record<string, unknown>;
  /** Optional environment vars that ABAC predicates may reference. */
  env?: Record<string, unknown>;
}

/**
 * Evaluates a hidden op's authorities. Two policies can apply — skill-level and
 * op-level — and BOTH must grant (AND semantics). When neither is present the
 * op is "unprotected": granted under the default `unprotectedOps: 'allow'`, or
 * blocked under `'deny'` unless the bundle marked the op `public: true`.
 *
 * The signed bundle verifies origin trust; this guard is the per-op
 * authorization boundary on the execution surface (`run_workflow` + the
 * internal per-op tools), since `load_skill` is NOT an auth boundary on the
 * stateless edge (no per-session loaded-skill state).
 */
export class AuthorityGuard {
  private readonly engine: AuthoritiesEngine;
  private readonly contextBuilder: AuthoritiesContextBuilder;
  private readonly logger: FrontMcpLogger | undefined;

  constructor(
    opts: {
      profiles?: AuthoritiesProfileRegistry;
      evaluators?: AuthoritiesEvaluatorRegistry;
      logger?: FrontMcpLogger;
    } = {},
  ) {
    const profiles = opts.profiles ?? new AuthoritiesProfileRegistry();
    const evaluators = opts.evaluators ?? new AuthoritiesEvaluatorRegistry();
    this.engine = new AuthoritiesEngine(profiles, evaluators);
    this.contextBuilder = new AuthoritiesContextBuilder();
    this.logger = opts.logger;
  }

  async check(args: AuthorityCheckArgs): Promise<AuthoritiesResult> {
    const { policy, skillPolicy, isPublic, authInfo, input, env } = args;
    const unprotectedOps: UnprotectedOpsPolicy = args.unprotectedOps ?? 'allow';

    // Both skill-level and op-level policies apply with AND semantics. Collect
    // the present ones; a `null` (vs `undefined`) is treated as "no policy" too.
    const policies = [skillPolicy, policy].filter((p): p is AuthoritiesPolicy => p !== undefined && p !== null);

    if (policies.length === 0) {
      // Unprotected op: no skill- or op-level policy.
      if (unprotectedOps === 'deny' && isPublic !== true) {
        return {
          granted: false,
          deniedBy: 'unprotected_operation_denied',
          message:
            'operation has no required-authorities policy and is not marked public; ' +
            'blocked by unprotectedOps:"deny" (set the op `public: true` or attach a policy)',
          evaluatedPolicies: [],
        };
      }
      // 'allow' (default): signed-bundle origin trust is the upstream gate.
      return { granted: true, evaluatedPolicies: [] };
    }

    // the skill-action executor documents a non-throwing contract — every authority
    // failure must surface as { granted: false, deniedBy: ... }. A malformed
    // policy or an unsupported authInfo shape can throw inside libs/auth's
    // contextBuilder.build / engine.evaluate, so wrap both in try/catch and
    // translate to the structured envelope.
    try {
      const ctx: AuthoritiesEvaluationContext = this.contextBuilder.build(authInfo, input, env);
      // AND across the applicable policies: the FIRST denial wins; only when
      // every present policy grants do we grant. evaluatedPolicies accumulate
      // for the audit trail.
      const evaluatedPolicies: string[] = [];
      for (const p of policies) {
        const res = await this.engine.evaluate(p as AuthoritiesMetadata, ctx);
        evaluatedPolicies.push(...(res.evaluatedPolicies ?? []));
        if (!res.granted) {
          return { ...res, evaluatedPolicies };
        }
      }
      return { granted: true, evaluatedPolicies };
    } catch (e) {
      const message = normalizeCaughtMessage(e);
      this.logger?.error(`[skilled-openapi:authority] evaluation failed: ${message}`);
      return {
        granted: false,
        deniedBy: 'authority_evaluation_failed',
        message,
        evaluatedPolicies: [],
      };
    }
  }
}

// Render a caught value into a string without ever throwing — covers the
// cases where libs/auth (or a buggy evaluator) throws null/undefined or a
// non-Error whose `.message` getter explodes.
function normalizeCaughtMessage(e: unknown): string {
  if (e instanceof Error) return e.message || 'authority evaluation threw';
  if (typeof e === 'string') return e;
  if (e !== null && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e ?? 'authority evaluation threw');
}
