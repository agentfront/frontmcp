// file: plugins/plugin-skilled-openapi/src/security/authority-guard.ts
//
// Adapter from the bundle's `requiredAuthorities` policy (a free-form
// Record<string, unknown> at the SDK boundary) into libs/auth's
// AuthoritiesEngine. When the server configures authorities (`@FrontMcp({
// authorities })` or AuthoritiesPlugin), the server's engine and context
// builder are used, so bundle rules read roles/permissions through the same
// `claimsMapping` / `claimsResolver`, and use the same custom evaluators, as
// `@Tool({ authorities })`. Without server authorities, the plugin's own default engine
// applies (roles from the `roles` claim, permissions from `permissions`).

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

/** The server's authorities engine and context builder, when the server configures authorities. */
export interface ServerAuthorities {
  engine: AuthoritiesEngine;
  contextBuilder: AuthoritiesContextBuilder;
}

/** What {@link AuthorityGuard.canDiscover} needs: the rules of an action, without its input. */
export type DiscoveryCheckArgs = Omit<AuthorityCheckArgs, 'input' | 'env' | 'policy'> & {
  policy?: AuthoritiesPolicy;
};

/**
 * Whether a policy reads the action's input (or runs code the guard can't see
 * into): `input.*` paths or keys, `fromInput` references, `custom` evaluators and
 * `guards`. Such a policy can't be judged before the action is called.
 */
export function policyDependsOnInput(value: unknown): boolean {
  if (typeof value === 'string') return value === 'input' || value.startsWith('input.');
  if (Array.isArray(value)) return value.some(policyDependsOnInput);
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'fromInput' || key === 'custom' || key === 'guards') return true;
      if (policyDependsOnInput(key) || policyDependsOnInput(nested)) return true;
    }
  }
  return false;
}

/**
 * The part of a policy that can be judged before the action is called, or `undefined` when
 * nothing can. A profile name is judged by the rule it names, so a profile that reads the
 * input can't be judged either; a list of profile names (AND) keeps the profiles that can.
 * An unregistered profile stays in: the engine denies it at call time as well.
 */
function judgeablePart(
  policy: AuthoritiesPolicy | undefined,
  engine: AuthoritiesEngine,
): AuthoritiesPolicy | undefined {
  if (policy === undefined || policy === null) return undefined;
  const profileDependsOnInput = (name: unknown): boolean =>
    typeof name === 'string' && policyDependsOnInput(engine.resolveProfile(name));
  const value: unknown = policy;
  if (typeof value === 'string') return profileDependsOnInput(value) ? undefined : policy;
  if (Array.isArray(value)) {
    const names = value.filter((name) => !profileDependsOnInput(name));
    return names.length > 0 ? (names as unknown as AuthoritiesPolicy) : undefined;
  }
  return policyDependsOnInput(policy) ? undefined : policy;
}

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
  private readonly serverAuthorities: (() => ServerAuthorities | undefined) | undefined;

  constructor(
    opts: {
      profiles?: AuthoritiesProfileRegistry;
      evaluators?: AuthoritiesEvaluatorRegistry;
      logger?: FrontMcpLogger;
      /**
       * The server's authorities, read on every check (the server may register
       * them after this guard is built). When it returns an engine and context
       * builder, they replace the guard's own defaults.
       */
      serverAuthorities?: () => ServerAuthorities | undefined;
    } = {},
  ) {
    const profiles = opts.profiles ?? new AuthoritiesProfileRegistry();
    const evaluators = opts.evaluators ?? new AuthoritiesEvaluatorRegistry();
    this.engine = new AuthoritiesEngine(profiles, evaluators);
    this.contextBuilder = new AuthoritiesContextBuilder();
    this.logger = opts.logger;
    this.serverAuthorities = opts.serverAuthorities;
  }

  /** The server's engine and context builder when it configures authorities, else the guard's own. */
  private authorities(): ServerAuthorities {
    return this.serverAuthorities?.() ?? { engine: this.engine, contextBuilder: this.contextBuilder };
  }

  /**
   * Whether the caller may be shown a skill or action (in `search_skill`,
   * `load_skill`, the catalog and the SDK skill surfaces), judged without the
   * action's input. A rule that depends on the input can't be judged yet and
   * doesn't hide anything; the call is still checked by {@link check}. Every other
   * rule must grant, and a policy-less action under `unprotectedOps: 'deny'` must
   * be public, exactly as at call time.
   */
  async canDiscover(args: DiscoveryCheckArgs): Promise<boolean> {
    const { engine } = this.authorities();
    const hasPolicy = [args.skillPolicy, args.policy].some((p) => p !== undefined && p !== null);
    const skillPolicy = judgeablePart(args.skillPolicy, engine);
    const policy = judgeablePart(args.policy, engine);
    // Only input-dependent rules: nothing to judge before the call.
    if (hasPolicy && skillPolicy === undefined && policy === undefined) return true;
    const result = await this.check({ ...args, skillPolicy, policy, input: {} });
    return result.granted;
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
      const { engine, contextBuilder } = this.authorities();
      const ctx: AuthoritiesEvaluationContext = contextBuilder.build(authInfo, input, env);
      // AND across the applicable policies: the FIRST denial wins; only when
      // every present policy grants do we grant. evaluatedPolicies accumulate
      // for the audit trail.
      const evaluatedPolicies: string[] = [];
      for (const p of policies) {
        const res = await engine.evaluate(p as AuthoritiesMetadata, ctx);
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
