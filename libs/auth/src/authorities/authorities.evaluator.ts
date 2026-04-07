/**
 * Built-in Authority Evaluators
 *
 * Pure functions for evaluating RBAC, ABAC, and ReBAC policies.
 */

import type {
  RbacRolesPolicy,
  RbacPermissionsPolicy,
  AbacPolicy,
  AbacCondition,
  RebacPolicy,
  ResourceIdRef,
  AuthoritiesResult,
  AuthoritiesEvaluationContext,
  DynamicValueRef,
} from './authorities.types';
import { resolveDotPath } from './authorities.context';

// ============================================
// RBAC Evaluators
// ============================================

/**
 * Evaluate RBAC roles policy against user roles.
 */
export function evaluateRbacRoles(
  policy: RbacRolesPolicy,
  ctx: AuthoritiesEvaluationContext,
): AuthoritiesResult {
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
function resolveValue(
  value: unknown,
  ctx: AuthoritiesEvaluationContext,
): unknown {
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
      if (typeof actual !== 'string' || typeof expected !== 'string') return false;
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Evaluate a single ABAC condition.
 */
function evaluateCondition(
  condition: AbacCondition,
  envelope: Record<string, unknown>,
  ctx: AuthoritiesEvaluationContext,
): boolean {
  const actual = resolveDotPath(envelope, condition.path);
  const expected = resolveValue(condition.value, ctx);
  return applyOperator(actual, condition.op, expected);
}

/**
 * Evaluate ABAC policy.
 */
export function evaluateAbac(
  policy: AbacPolicy,
  ctx: AuthoritiesEvaluationContext,
): AuthoritiesResult {
  const envelope = buildContextEnvelope(ctx);

  // Evaluate match (simple equality checks)
  if (policy.match) {
    for (const [path, expectedRaw] of Object.entries(policy.match)) {
      const actual = resolveDotPath(envelope, path);
      const expected = resolveValue(expectedRaw, ctx);
      if (actual !== expected) {
        return {
          granted: false,
          deniedBy: `attributes.match: '${path}' expected '${String(expected)}' but got '${String(actual)}'`,
          denial: { kind: 'attributes', path: 'attributes.match', expected, actual },
          evaluatedPolicies: ['attributes.match'],
        };
      }
    }
  }

  // Evaluate conditions (advanced operator checks)
  if (policy.conditions) {
    for (let i = 0; i < policy.conditions.length; i++) {
      const condition = policy.conditions[i];
      if (!evaluateCondition(condition, envelope, ctx)) {
        const expected = resolveValue(condition.value, ctx);
        const actual = resolveDotPath(envelope, condition.path);
        return {
          granted: false,
          deniedBy: `attributes.conditions: '${condition.path}' failed '${condition.op}' check against '${String(expected)}'`,
          denial: { kind: 'attributes', path: `attributes.conditions[${i}]`, expected, actual },
          evaluatedPolicies: ['attributes.conditions'],
        };
      }
    }
  }

  return { granted: true, evaluatedPolicies: ['attributes'] };
}

// ============================================
// ReBAC Evaluator
// ============================================

/**
 * Resolve a ResourceIdRef to a concrete string.
 */
export function resolveResourceId(
  ref: ResourceIdRef,
  ctx: AuthoritiesEvaluationContext,
): string | undefined {
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
async function evaluateSingleRebac(
  policy: RebacPolicy,
  ctx: AuthoritiesEvaluationContext,
): Promise<AuthoritiesResult> {
  const resourceId = resolveResourceId(policy.resourceId, ctx);
  if (resourceId === undefined) {
    return {
      granted: false,
      deniedBy: `relationships: could not resolve resourceId for ${policy.resource}`,
      denial: { kind: 'relationships', path: 'relationships', expected: `${policy.resource}:resourceId`, actual: undefined },
      evaluatedPolicies: ['relationships'],
    };
  }

  const hasRelationship = await ctx.relationships.check(
    policy.type,
    policy.resource,
    resourceId,
    ctx.user.sub,
    ctx,
  );

  if (!hasRelationship) {
    return {
      granted: false,
      deniedBy: `relationships: user '${ctx.user.sub}' is not '${policy.type}' of ${policy.resource}:${resourceId}`,
      denial: { kind: 'relationships', path: 'relationships', expected: `${policy.type}:${policy.resource}:${resourceId}` },
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

  for (const p of policies) {
    const result = await evaluateSingleRebac(p, ctx);
    if (!result.granted) return result;
  }

  return { granted: true, evaluatedPolicies: ['relationships'] };
}
