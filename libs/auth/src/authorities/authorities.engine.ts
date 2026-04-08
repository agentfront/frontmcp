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
 * A granted result with the given policies.
 */
function granted(policies: string[]): AuthoritiesResult {
  return { granted: true, evaluatedPolicies: policies };
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
  constructor(
    private readonly profiles: AuthoritiesProfileRegistry,
    private readonly evaluators: AuthoritiesEvaluatorRegistry,
  ) {}

  /**
   * Evaluate an AuthoritiesMetadata value (string, string[], or policy object).
   */
  async evaluate(authorities: AuthoritiesMetadata, ctx: AuthoritiesEvaluationContext): Promise<AuthoritiesResult> {
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

    // No fields specified → grant (empty policy = no restrictions)
    if (results.length === 0) {
      return granted([]);
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
   * Each guard returns true (granted) or a string (denial message).
   */
  private async evaluateGuards(
    guards: AuthorityGuardFn[],
    ctx: AuthoritiesEvaluationContext,
  ): Promise<AuthoritiesResult> {
    for (let i = 0; i < guards.length; i++) {
      const guard = guards[i];
      const result = await guard(ctx);
      if (result === false || typeof result === 'string') {
        const denialMessage = typeof result === 'string' ? result : `guard[${i}] denied`;
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
