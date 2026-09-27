/**
 * Authorities Evaluation Engine
 *
 * Orchestrates policy evaluation with profile resolution,
 * built-in evaluators, custom evaluators, and combinators.
 */

import { evaluateAbac, evaluateRbacPermissions, evaluateRbacRoles, evaluateRebac } from './authorities.evaluator';
import type { AuthoritiesEvaluatorRegistry, AuthoritiesProfileRegistry } from './authorities.registry';
import type {
  AuthoritiesEvaluationContext,
  AuthoritiesMetadata,
  AuthoritiesPolicyMetadata,
  AuthoritiesResult,
  AuthorityGuardFn,
} from './authorities.types';
import { findAuthoritiesProfileProblems, findAuthoritiesRuleProblems } from './authorities.validation';

/**
 * Merges two AuthoritiesResult arrays, combining evaluatedPolicies.
 */
function mergeResult(base: AuthoritiesResult, ...others: AuthoritiesResult[]): AuthoritiesResult {
  const evaluatedPolicies = [...base.evaluatedPolicies];
  for (const other of others) {
    evaluatedPolicies.push(...other.evaluatedPolicies);
  }
  return { ...base, evaluatedPolicies };
}

/**
 * A denial for a rule that is malformed or checks nothing. Such a rule must never grant,
 * and it is refused before evaluation so a `not` around it cannot turn it into a grant.
 */
function invalidRule(problems: string[], policies: string[] = []): AuthoritiesResult {
  return {
    granted: false,
    deniedBy: `invalid authorities rule: ${problems.join('; ')}`,
    evaluatedPolicies: policies,
  };
}

/**
 * The main evaluation engine.
 *
 * Usage:
 * ```typescript
 * const engine = new AuthoritiesEngine(profileRegistry, evaluatorRegistry);
 * const result = await engine.evaluate(authorities, ctx);
 * if (!result.granted) throw new AuthorityDeniedError({ ... });
 * ```
 */
export class AuthoritiesEngine {
  /** Problems found per rule object, so a rule is validated once however often it is evaluated. */
  private readonly ruleProblems = new WeakMap<object, string[]>();

  constructor(
    private readonly profiles: AuthoritiesProfileRegistry,
    private readonly evaluators: AuthoritiesEvaluatorRegistry,
  ) {}

  /**
   * Problems with an `authorities` value declared on an entry (see {@link findAuthoritiesRuleProblems}).
   * The server reports them when it starts; {@link evaluate} denies such a value.
   */
  findRuleProblems(authorities: unknown): string[] {
    return findAuthoritiesRuleProblems(authorities);
  }

  /**
   * Problems with every registered profile's rule (see {@link findAuthoritiesRuleProblems}).
   * The server reports them when it starts.
   */
  findProfileProblems(): string[] {
    return Object.entries(this.profiles.getAll()).flatMap(([name, policy]) =>
      findAuthoritiesProfileProblems(name, policy),
    );
  }

  /**
   * Evaluate an AuthoritiesMetadata value (string, string[], or policy object).
   *
   * A value that is malformed or checks nothing (see {@link findAuthoritiesRuleProblems}) is denied.
   */
  async evaluate(authorities: AuthoritiesMetadata, ctx: AuthoritiesEvaluationContext): Promise<AuthoritiesResult> {
    const problems = this.problemsOf(authorities, findAuthoritiesRuleProblems);
    if (problems.length > 0) return invalidRule(problems);

    // String → single profile lookup
    if (typeof authorities === 'string') {
      return this.evaluateProfile(authorities, ctx);
    }

    // String array → evaluate each profile as AND
    if (Array.isArray(authorities)) {
      return this.evaluateProfileArray(authorities as string[], ctx);
    }

    // Policy object → evaluate inline
    return this.evaluatePolicy(authorities, ctx);
  }

  /**
   * Resolve and evaluate a single named profile.
   */
  private async evaluateProfile(name: string, ctx: AuthoritiesEvaluationContext): Promise<AuthoritiesResult> {
    const policy = this.profiles.resolve(name);
    if (!policy) {
      return {
        granted: false,
        deniedBy: `profile '${name}' is not registered`,
        evaluatedPolicies: [`profile:${name}`],
      };
    }

    const problems = this.problemsOf(policy, (rule) => findAuthoritiesProfileProblems(name, rule));
    if (problems.length > 0) return invalidRule(problems, [`profile:${name}`]);

    const result = await this.evaluatePolicy(policy, ctx);
    if (!result.granted) {
      return {
        ...result,
        deniedBy: `profile:${name}: ${result.deniedBy}`,
        evaluatedPolicies: [`profile:${name}`, ...result.evaluatedPolicies],
      };
    }

    return mergeResult(result, { granted: true, evaluatedPolicies: [`profile:${name}`] });
  }

  /** Validate a rule, reusing the result for a rule object seen before. */
  private problemsOf(rule: unknown, find: (rule: unknown) => string[]): string[] {
    if (typeof rule !== 'object' || rule === null) return find(rule);
    let problems = this.ruleProblems.get(rule);
    if (!problems) {
      problems = find(rule);
      this.ruleProblems.set(rule, problems);
    }
    return problems;
  }

  /**
   * Evaluate an array of profile names (AND semantics).
   */
  private async evaluateProfileArray(names: string[], ctx: AuthoritiesEvaluationContext): Promise<AuthoritiesResult> {
    const allPolicies: string[] = [];

    for (const name of names) {
      const result = await this.evaluateProfile(name, ctx);
      allPolicies.push(...result.evaluatedPolicies);
      if (!result.granted) {
        return { ...result, evaluatedPolicies: allPolicies };
      }
    }

    return { granted: true, evaluatedPolicies: allPolicies };
  }

  /**
   * Evaluate an inline policy object.
   */
  private async evaluatePolicy(
    policy: AuthoritiesPolicyMetadata,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const operator = policy.operator ?? 'AND';
    const results: AuthoritiesResult[] = [];

    // Collect results from each field
    if (policy.roles) {
      results.push(evaluateRbacRoles(policy.roles, ctx));
    }
    if (policy.permissions) {
      results.push(evaluateRbacPermissions(policy.permissions, ctx));
    }
    if (policy.attributes) {
      results.push(evaluateAbac(policy.attributes, ctx));
    }
    if (policy.relationships) {
      results.push(await evaluateRebac(policy.relationships, ctx));
    }
    if (policy.custom) {
      results.push(await this.evaluateCustom(policy.custom, ctx));
    }
    if (policy.guards && policy.guards.length > 0) {
      results.push(await this.evaluateGuards(policy.guards, ctx));
    }

    // Combinators
    if (policy.allOf) {
      results.push(await this.evaluateAllOf(policy.allOf, ctx));
    }
    if (policy.anyOf) {
      results.push(await this.evaluateAnyOf(policy.anyOf, ctx));
    }
    if (policy.not) {
      results.push(await this.evaluateNot(policy.not, ctx));
    }

    // A rule that checks nothing never grants (evaluate() refuses it before it gets here).
    if (results.length === 0) {
      return invalidRule(['checks nothing']);
    }

    // Combine with operator
    return this.combineResults(results, operator);
  }

  /**
   * Combine results with AND or OR semantics.
   */
  private combineResults(results: AuthoritiesResult[], operator: 'AND' | 'OR'): AuthoritiesResult {
    const allPolicies = results.flatMap((r) => r.evaluatedPolicies);

    if (operator === 'AND') {
      const denied = results.find((r) => !r.granted);
      if (denied) {
        return { ...denied, evaluatedPolicies: allPolicies };
      }
      return { granted: true, evaluatedPolicies: allPolicies };
    }

    // OR: at least one must pass
    const anyGranted = results.some((r) => r.granted);
    if (anyGranted) {
      return { granted: true, evaluatedPolicies: allPolicies };
    }

    // All denied — report the first denial
    const firstDenied = results.find((r) => !r.granted);
    return {
      granted: false,
      deniedBy: firstDenied?.deniedBy ?? 'all policies denied (OR)',
      evaluatedPolicies: allPolicies,
    };
  }

  /**
   * Evaluate custom evaluators.
   */
  private async evaluateCustom(
    custom: Record<string, unknown>,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const allPolicies: string[] = [];

    for (const [name, config] of Object.entries(custom)) {
      const evaluator = this.evaluators.get(name);
      if (!evaluator) {
        return {
          granted: false,
          deniedBy: `custom evaluator '${name}' is not registered`,
          evaluatedPolicies: [...allPolicies, `custom.${name}`],
        };
      }

      const result = await evaluator.evaluate(config, ctx);
      allPolicies.push(`custom.${name}`, ...result.evaluatedPolicies);

      if (!result.granted) {
        return { ...result, evaluatedPolicies: allPolicies };
      }
    }

    return { granted: true, evaluatedPolicies: allPolicies };
  }

  /**
   * Evaluate async guard functions in sequence.
   * Only `true` grants. A string is the denial message; anything else (`false`, but also
   * `undefined` from a guard that forgot to return, `null`, `0` or an object) denies.
   */
  private async evaluateGuards(
    guards: AuthorityGuardFn[],
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    for (let i = 0; i < guards.length; i++) {
      const guard = guards[i];
      const result: unknown = await guard(ctx);
      if (result !== true) {
        const denialMessage =
          typeof result === 'string'
            ? result
            : result === false
              ? `guard[${i}] denied`
              : `guard[${i}] did not return true (returned ${result === null ? 'null' : typeof result})`;
        return {
          granted: false,
          deniedBy: `guards[${i}]: ${denialMessage}`,
          denial: { kind: 'custom', path: `guards[${i}]` },
          evaluatedPolicies: ['guards'],
        };
      }
    }
    return { granted: true, evaluatedPolicies: ['guards'] };
  }

  /**
   * allOf combinator — all nested policies must pass.
   */
  private async evaluateAllOf(
    policies: AuthoritiesPolicyMetadata[],
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const allPolicies: string[] = ['allOf'];

    for (const policy of policies) {
      const result = await this.evaluatePolicy(policy, ctx);
      allPolicies.push(...result.evaluatedPolicies);
      if (!result.granted) {
        return { ...result, evaluatedPolicies: allPolicies };
      }
    }

    return { granted: true, evaluatedPolicies: allPolicies };
  }

  /**
   * anyOf combinator — at least one nested policy must pass.
   */
  private async evaluateAnyOf(
    policies: AuthoritiesPolicyMetadata[],
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const allPolicies: string[] = ['anyOf'];
    let lastDenied: AuthoritiesResult | undefined;

    for (const policy of policies) {
      const result = await this.evaluatePolicy(policy, ctx);
      allPolicies.push(...result.evaluatedPolicies);
      if (result.granted) {
        return { granted: true, evaluatedPolicies: allPolicies };
      }
      lastDenied = result;
    }

    return {
      granted: false,
      deniedBy: lastDenied?.deniedBy ?? 'no policies in anyOf',
      denial: lastDenied?.denial ?? { kind: 'anyOf', path: 'anyOf' },
      evaluatedPolicies: allPolicies,
    };
  }

  /**
   * not combinator — inverts the nested policy result.
   */
  private async evaluateNot(
    policy: AuthoritiesPolicyMetadata,
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    const result = await this.evaluatePolicy(policy, ctx);

    return {
      granted: !result.granted,
      deniedBy: result.granted ? 'not: inner policy was granted (negated to denied)' : undefined,
      denial: result.granted ? { kind: 'not', path: 'not' } : undefined,
      evaluatedPolicies: ['not', ...result.evaluatedPolicies],
    };
  }
}
