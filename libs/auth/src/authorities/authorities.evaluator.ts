/**
 * Built-in Authority Evaluators
 *
 * Pure functions for evaluating RBAC, ABAC, and ReBAC policies.
 */

import { isPatternSafe } from '@frontmcp/utils';

import { isAnonymousSubject, noopRelationshipResolver, resolveDotPath } from './authorities.context';
import type {
  AbacPolicy,
  AuthoritiesEvaluationContext,
  AuthoritiesResult,
  RbacPermissionsPolicy,
  RbacRolesPolicy,
  RebacPolicy,
  ResourceIdRef,
} from './authorities.types';

// ============================================
// RBAC Evaluators
// ============================================

/**
 * Evaluate RBAC roles policy against user roles.
 */
export function evaluateRbacRoles(policy: RbacRolesPolicy, ctx: AuthoritiesEvaluationContext): AuthoritiesResult {
  const userRoles = ctx.user.roles;

  if (policy.all) {
    const missing = policy.all.filter((r) => !userRoles.includes(r));
    if (missing.length > 0) {
      return {
        granted: false,
        deniedBy: `roles.all: missing ${missing.map((r) => `'${r}'`).join(', ')}`,
        denial: { kind: 'roles', path: 'roles.all', missing },
        evaluatedPolicies: ['roles.all'],
      };
    }
  }

  if (policy.any) {
    const hasAny = policy.any.some((r) => userRoles.includes(r));
    if (!hasAny) {
      return {
        granted: false,
        deniedBy: `roles.any: user has none of ${policy.any.map((r) => `'${r}'`).join(', ')}`,
        denial: { kind: 'roles', path: 'roles.any', missing: policy.any },
        evaluatedPolicies: ['roles.any'],
      };
    }
  }

  return { granted: true, evaluatedPolicies: ['roles'] };
}

/**
 * Evaluate RBAC permissions policy against user permissions.
 */
export function evaluateRbacPermissions(
  policy: RbacPermissionsPolicy,
  ctx: AuthoritiesEvaluationContext,
): AuthoritiesResult {
  const userPerms = ctx.user.permissions;

  if (policy.all) {
    const missing = policy.all.filter((p) => !userPerms.includes(p));
    if (missing.length > 0) {
      return {
        granted: false,
        deniedBy: `permissions.all: missing ${missing.map((p) => `'${p}'`).join(', ')}`,
        denial: { kind: 'permissions', path: 'permissions.all', missing },
        evaluatedPolicies: ['permissions.all'],
      };
    }
  }

  if (policy.any) {
    const hasAny = policy.any.some((p) => userPerms.includes(p));
    if (!hasAny) {
      return {
        granted: false,
        deniedBy: `permissions.any: user has none of ${policy.any.map((p) => `'${p}'`).join(', ')}`,
        denial: { kind: 'permissions', path: 'permissions.any', missing: policy.any },
        evaluatedPolicies: ['permissions.any'],
      };
    }
  }

  return { granted: true, evaluatedPolicies: ['permissions'] };
}

// ============================================
// ABAC Evaluators
// ============================================

/**
 * Build a flat context envelope for dot-path resolution.
 */
function buildContextEnvelope(ctx: AuthoritiesEvaluationContext): Record<string, unknown> {
  return {
    user: ctx.user,
    claims: ctx.user.claims,
    input: ctx.input,
    env: ctx.env,
  };
}

/**
 * Resolve a value that may be a literal or a DynamicValueRef.
 */
function resolveValue(value: unknown, ctx: AuthoritiesEvaluationContext): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ('fromInput' in obj && typeof obj['fromInput'] === 'string') {
      return ctx.input[obj['fromInput'] as string];
    }
    if ('fromClaims' in obj && typeof obj['fromClaims'] === 'string') {
      return resolveDotPath(ctx.user.claims, obj['fromClaims'] as string);
    }
  }
  return value;
}

/** How a denial names the input field or claim that a missing expected value refers to. */
function describeMissingValue(value: unknown): string {
  const reference = (value ?? {}) as Record<string, unknown>;
  if (typeof reference['fromInput'] === 'string') return `input '${reference['fromInput']}'`;
  if (typeof reference['fromClaims'] === 'string') return `claim '${reference['fromClaims']}'`;
  return 'the value';
}

/** A check whose expected value is missing (e.g. an absent fromInput) denies as unresolved, even under `not`. */
function unresolvedAttribute(
  policyPath: string,
  denialPath: string,
  path: string,
  value: unknown,
  actual: unknown,
): AuthoritiesResult {
  return {
    granted: false,
    unresolved: true,
    deniedBy: `${policyPath}: '${path}' could not be checked: ${describeMissingValue(value)} is missing`,
    denial: { kind: 'attributes', path: denialPath, actual },
    evaluatedPolicies: [policyPath],
  };
}

const MAX_PATTERN_LENGTH = 256;
const MAX_MATCHED_LENGTH = 10_000;

/** Why a `matches` check cannot run on these values in bounded time, or undefined when it can. */
export function unmatchableReason(actual: unknown, pattern: unknown): string | undefined {
  if (typeof pattern !== 'string') return undefined;
  if (pattern.length > MAX_PATTERN_LENGTH) return `the pattern is longer than ${MAX_PATTERN_LENGTH} characters`;
  if (!isPatternSafe(pattern)) {
    return 'the pattern is not a valid regular expression, or its matching time can grow very fast with the value';
  }
  if (typeof actual === 'string' && actual.length > MAX_MATCHED_LENGTH) {
    return `the value is longer than ${MAX_MATCHED_LENGTH} characters`;
  }
  return undefined;
}

/**
 * Apply an ABAC operator to compare actual vs expected values.
 */
function applyOperator(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'notIn':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'contains':
      if (typeof actual === 'string' && typeof expected === 'string') return actual.includes(expected);
      if (Array.isArray(actual)) return actual.includes(expected);
      return false;
    case 'startsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'endsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    case 'exists':
      return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null;
    case 'matches':
      return typeof actual === 'string' && typeof expected === 'string' && new RegExp(expected).test(actual);
    default:
      return false;
  }
}

const REDACTED_ENV_VALUE = '[redacted]';

/** A value read from `env.*` stays out of a denial: denials reach the client, environment variables may be secrets. */
function reportableActual(path: string, actual: unknown): unknown {
  return path === 'env' || path.startsWith('env.') ? REDACTED_ENV_VALUE : actual;
}

/**
 * Evaluate ABAC policy.
 */
export function evaluateAbac(policy: AbacPolicy, ctx: AuthoritiesEvaluationContext): AuthoritiesResult {
  const envelope = buildContextEnvelope(ctx);
  let unresolved: AuthoritiesResult | undefined;

  // Evaluate match (simple equality checks)
  if (policy.match) {
    for (const [path, expectedRaw] of Object.entries(policy.match)) {
      const actual = resolveDotPath(envelope, path);
      const expected = resolveValue(expectedRaw, ctx);
      const reported = reportableActual(path, actual);
      if (expected === undefined) {
        unresolved ??= unresolvedAttribute('attributes.match', 'attributes.match', path, expectedRaw, reported);
      } else if (actual !== expected) {
        return {
          granted: false,
          deniedBy: `attributes.match: '${path}' expected '${String(expected)}' but got '${String(reported)}'`,
          denial: { kind: 'attributes', path: 'attributes.match', expected, actual: reported },
          evaluatedPolicies: ['attributes.match'],
        };
      }
    }
  }

  // Evaluate conditions (advanced operator checks)
  if (policy.conditions) {
    for (let i = 0; i < policy.conditions.length; i++) {
      const condition = policy.conditions[i];
      const denialPath = `attributes.conditions[${i}]`;
      const actual = resolveDotPath(envelope, condition.path);
      const expected = resolveValue(condition.value, ctx);
      const reported = reportableActual(condition.path, actual);
      const unmatchable = condition.op === 'matches' ? unmatchableReason(actual, expected) : undefined;
      if (expected === undefined) {
        unresolved ??= unresolvedAttribute(
          'attributes.conditions',
          denialPath,
          condition.path,
          condition.value,
          reported,
        );
      } else if (unmatchable !== undefined) {
        unresolved ??= {
          granted: false,
          unresolved: true,
          deniedBy: `attributes.conditions: '${condition.path}' could not be checked: ${unmatchable}`,
          denial: { kind: 'attributes', path: denialPath, actual: reported },
          evaluatedPolicies: ['attributes.conditions'],
        };
      } else if (!applyOperator(actual, condition.op, expected)) {
        return {
          granted: false,
          deniedBy: `attributes.conditions: '${condition.path}' failed '${condition.op}' check against '${String(expected)}'`,
          denial: { kind: 'attributes', path: denialPath, expected, actual: reported },
          evaluatedPolicies: ['attributes.conditions'],
        };
      }
    }
  }

  return unresolved ?? { granted: true, evaluatedPolicies: ['attributes'] };
}

// ============================================
// ReBAC Evaluator
// ============================================

/**
 * Resolve a ResourceIdRef to a concrete string.
 */
export function resolveResourceId(ref: ResourceIdRef, ctx: AuthoritiesEvaluationContext): string | undefined {
  if (typeof ref === 'string') return ref;

  if ('fromInput' in ref) {
    const val = ctx.input[ref.fromInput];
    return typeof val === 'string' ? val : undefined;
  }

  if ('fromClaims' in ref) {
    const val = resolveDotPath(ctx.user.claims, ref.fromClaims);
    return typeof val === 'string' ? val : undefined;
  }

  return undefined;
}

/**
 * Evaluate a single ReBAC policy.
 */
async function evaluateSingleRebac(policy: RebacPolicy, ctx: AuthoritiesEvaluationContext): Promise<AuthoritiesResult> {
  const userSub = ctx.user.sub;
  if (userSub === undefined || isAnonymousSubject(userSub)) {
    return {
      granted: false,
      deniedBy: `relationships: an anonymous caller cannot be '${policy.type}' of ${policy.resource}`,
      denial: { kind: 'relationships', path: 'user.sub', expected: 'a signed-in caller', actual: undefined },
      evaluatedPolicies: ['relationships'],
    };
  }
  if (ctx.relationships === noopRelationshipResolver) {
    return {
      granted: false,
      unresolved: true,
      deniedBy:
        `relationships: '${policy.type}' of ${policy.resource} could not be checked: ` +
        'no relationship resolver is configured (set authorities.relationshipResolver)',
      denial: { kind: 'relationships', path: 'relationships', expected: `${policy.type}:${policy.resource}` },
      evaluatedPolicies: ['relationships'],
    };
  }
  const resourceId = resolveResourceId(policy.resourceId, ctx);
  if (resourceId === undefined) {
    return {
      granted: false,
      unresolved: true,
      deniedBy: `relationships: could not resolve resourceId for ${policy.resource}`,
      denial: {
        kind: 'relationships',
        path: 'relationships',
        expected: `${policy.resource}:resourceId`,
        actual: undefined,
      },
      evaluatedPolicies: ['relationships'],
    };
  }

  const hasRelationship = await ctx.relationships.check(policy.type, policy.resource, resourceId, userSub, ctx);

  if (!hasRelationship) {
    return {
      granted: false,
      deniedBy: `relationships: user '${userSub}' is not '${policy.type}' of ${policy.resource}:${resourceId}`,
      denial: {
        kind: 'relationships',
        path: 'relationships',
        expected: `${policy.type}:${policy.resource}:${resourceId}`,
      },
      evaluatedPolicies: ['relationships'],
    };
  }

  return { granted: true, evaluatedPolicies: ['relationships'] };
}

/**
 * Evaluate ReBAC policy (single or array).
 * Multiple policies are AND-ed (all relationships must hold).
 */
export async function evaluateRebac(
  policy: RebacPolicy | RebacPolicy[],
  ctx: AuthoritiesEvaluationContext,
): Promise<AuthoritiesResult> {
  const policies = Array.isArray(policy) ? policy : [policy];
  let unresolved: AuthoritiesResult | undefined;

  for (const p of policies) {
    const result = await evaluateSingleRebac(p, ctx);
    if (result.granted) continue;
    if (!result.unresolved) return result;
    unresolved ??= result;
  }

  return unresolved ?? { granted: true, evaluatedPolicies: ['relationships'] };
}
