/**
 * Zod Validation Schemas for Authorities
 *
 * Runtime validation for authorities metadata, profiles, and claims mapping.
 */

import { z } from '@frontmcp/lazy-zod';

import type { AuthoritiesClaimsMapping, AuthoritiesConfig } from './authorities.profiles';
import type {
  AbacCondition,
  AbacOperator,
  AbacPolicy,
  AuthoritiesMetadata,
  AuthoritiesPolicyMetadata,
  AuthorityGuardFn,
  RbacPermissionsPolicy,
  RbacRolesPolicy,
  RebacPolicy,
  ResourceIdRef,
} from './authorities.types';

// ============================================
// RBAC Schemas
// ============================================

export const rbacRolesPolicySchema: z.ZodType<RbacRolesPolicy> = z
  .object({
    all: z.array(z.string().min(1)).optional(),
    any: z.array(z.string().min(1)).optional(),
  })
  .refine((data) => data.all !== undefined || data.any !== undefined, {
    message: 'Roles policy must have at least "all" or "any"',
  });

export const rbacPermissionsPolicySchema: z.ZodType<RbacPermissionsPolicy> = z
  .object({
    all: z.array(z.string().min(1)).optional(),
    any: z.array(z.string().min(1)).optional(),
  })
  .refine((data) => data.all !== undefined || data.any !== undefined, {
    message: 'Permissions policy must have at least "all" or "any"',
  });

// ============================================
// ABAC Schemas
// ============================================

export const abacOperatorSchema: z.ZodType<AbacOperator> = z.enum([
  'eq',
  'neq',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
  'exists',
  'matches',
]);

export const abacConditionSchema: z.ZodType<AbacCondition> = z.object({
  path: z.string().min(1),
  op: abacOperatorSchema,
  value: z.unknown(),
});

export const abacPolicySchema: z.ZodType<AbacPolicy> = z
  .object({
    match: z.record(z.string(), z.unknown()).optional(),
    conditions: z.array(abacConditionSchema).optional(),
  })
  .refine((data) => data.match !== undefined || data.conditions !== undefined, {
    message: 'Attributes policy must have at least "match" or "conditions"',
  });

// ============================================
// ReBAC Schemas
// ============================================

export const resourceIdRefSchema: z.ZodType<ResourceIdRef> = z.union([
  z.string().min(1),
  z.object({ fromInput: z.string().min(1) }).strict(),
  z.object({ fromClaims: z.string().min(1) }).strict(),
]);

export const rebacPolicySchema: z.ZodType<RebacPolicy> = z.object({
  type: z.string().min(1),
  resource: z.string().min(1),
  resourceId: resourceIdRefSchema,
});

// ============================================
// Policy Schema (recursive for combinators)
// ============================================

const basePolicyShape = {
  roles: rbacRolesPolicySchema.optional(),
  permissions: rbacPermissionsPolicySchema.optional(),
  attributes: abacPolicySchema.optional(),
  relationships: z.union([rebacPolicySchema, z.array(rebacPolicySchema)]).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  guards: z.array(z.instanceof(Function) as unknown as z.ZodType<AuthorityGuardFn>).optional(),
  operator: z.enum(['AND', 'OR']).optional(),
};

export const authoritiesPolicySchema: z.ZodType<AuthoritiesPolicyMetadata> = z.lazy(() =>
  z.object({
    ...basePolicyShape,
    not: authoritiesPolicySchema.optional(),
    anyOf: z.array(authoritiesPolicySchema).optional(),
    allOf: z.array(authoritiesPolicySchema).optional(),
  }),
);

// ============================================
// Unified AuthoritiesMetadata Schema
// ============================================

/**
 * Validates the `authorities` field on any entry decorator.
 * Accepts: string (profile), string[] (profiles), or policy object.
 */
export const authoritiesMetadataSchema: z.ZodType<AuthoritiesMetadata> = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
  authoritiesPolicySchema,
]);

// ============================================
// Claims Mapping Schema
// ============================================

export const authoritiesClaimsMappingSchema: z.ZodType<AuthoritiesClaimsMapping> = z
  .record(z.string(), z.string().optional())
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Claims mapping must have at least one mapping',
  });

// ============================================
// AuthoritiesConfig Schema
// ============================================

export const authoritiesConfigSchema: z.ZodType<AuthoritiesConfig> = z.object({
  claimsMapping: authoritiesClaimsMappingSchema.optional(),
  profiles: z.record(z.string().min(1), authoritiesPolicySchema).optional(),
});
