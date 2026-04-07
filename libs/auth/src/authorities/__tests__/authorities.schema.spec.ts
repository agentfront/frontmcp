import {
  rbacRolesPolicySchema,
  rbacPermissionsPolicySchema,
  abacOperatorSchema,
  abacConditionSchema,
  abacPolicySchema,
  resourceIdRefSchema,
  rebacPolicySchema,
  authoritiesPolicySchema,
  authoritiesMetadataSchema,
  authoritiesClaimsMappingSchema,
  authoritiesConfigSchema,
} from '../authorities.schema';

describe('Authorities Schemas', () => {
  // =============================================
  // RBAC Schemas
  // =============================================

  describe('rbacRolesPolicySchema', () => {
    it('should accept policy with "all" only', () => {
      const result = rbacRolesPolicySchema.safeParse({ all: ['admin'] });
      expect(result.success).toBe(true);
    });

    it('should accept policy with "any" only', () => {
      const result = rbacRolesPolicySchema.safeParse({ any: ['admin', 'moderator'] });
      expect(result.success).toBe(true);
    });

    it('should accept policy with both "all" and "any"', () => {
      const result = rbacRolesPolicySchema.safeParse({ all: ['admin'], any: ['manager'] });
      expect(result.success).toBe(true);
    });

    it('should reject empty object (no all or any)', () => {
      const result = rbacRolesPolicySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject empty string in roles', () => {
      const result = rbacRolesPolicySchema.safeParse({ all: [''] });
      expect(result.success).toBe(false);
    });
  });

  describe('rbacPermissionsPolicySchema', () => {
    it('should accept policy with "all" permissions', () => {
      const result = rbacPermissionsPolicySchema.safeParse({ all: ['users:read', 'users:write'] });
      expect(result.success).toBe(true);
    });

    it('should accept policy with "any" permissions', () => {
      const result = rbacPermissionsPolicySchema.safeParse({ any: ['users:delete'] });
      expect(result.success).toBe(true);
    });

    it('should reject empty object', () => {
      const result = rbacPermissionsPolicySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // =============================================
  // ABAC Schemas
  // =============================================

  describe('abacOperatorSchema', () => {
    const validOps = ['eq', 'neq', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith', 'exists', 'matches'];

    it.each(validOps)('should accept operator "%s"', (op) => {
      expect(abacOperatorSchema.safeParse(op).success).toBe(true);
    });

    it('should reject invalid operator', () => {
      expect(abacOperatorSchema.safeParse('between').success).toBe(false);
    });
  });

  describe('abacConditionSchema', () => {
    it('should accept a valid condition', () => {
      const result = abacConditionSchema.safeParse({
        path: 'user.department',
        op: 'eq',
        value: 'engineering',
      });
      expect(result.success).toBe(true);
    });

    it('should accept condition with dynamic value ref', () => {
      const result = abacConditionSchema.safeParse({
        path: 'claims.org_id',
        op: 'eq',
        value: { fromInput: 'tenantId' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty path', () => {
      const result = abacConditionSchema.safeParse({ path: '', op: 'eq', value: 'x' });
      expect(result.success).toBe(false);
    });
  });

  describe('abacPolicySchema', () => {
    it('should accept policy with match only', () => {
      const result = abacPolicySchema.safeParse({
        match: { 'user.department': 'engineering' },
      });
      expect(result.success).toBe(true);
    });

    it('should accept policy with conditions only', () => {
      const result = abacPolicySchema.safeParse({
        conditions: [{ path: 'user.level', op: 'gte', value: 5 }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept policy with both match and conditions', () => {
      const result = abacPolicySchema.safeParse({
        match: { 'env.NODE_ENV': 'production' },
        conditions: [{ path: 'user.sub', op: 'exists', value: true }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty object (no match or conditions)', () => {
      const result = abacPolicySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // =============================================
  // ReBAC Schemas
  // =============================================

  describe('resourceIdRefSchema', () => {
    it('should accept a string', () => {
      expect(resourceIdRefSchema.safeParse('site-123').success).toBe(true);
    });

    it('should accept fromInput', () => {
      expect(resourceIdRefSchema.safeParse({ fromInput: 'siteId' }).success).toBe(true);
    });

    it('should accept fromClaims', () => {
      expect(resourceIdRefSchema.safeParse({ fromClaims: 'user.orgId' }).success).toBe(true);
    });

    it('should reject empty string', () => {
      expect(resourceIdRefSchema.safeParse('').success).toBe(false);
    });

    it('should reject object with both fromInput and fromClaims', () => {
      const result = resourceIdRefSchema.safeParse({ fromInput: 'a', fromClaims: 'b' });
      expect(result.success).toBe(false);
    });
  });

  describe('rebacPolicySchema', () => {
    it('should accept a valid policy', () => {
      const result = rebacPolicySchema.safeParse({
        type: 'member',
        resource: 'site',
        resourceId: { fromInput: 'siteId' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing fields', () => {
      expect(rebacPolicySchema.safeParse({ type: 'member' }).success).toBe(false);
    });
  });

  // =============================================
  // Policy Schema (with combinators)
  // =============================================

  describe('authoritiesPolicySchema', () => {
    it('should accept a policy with roles only', () => {
      const result = authoritiesPolicySchema.safeParse({
        roles: { any: ['admin'] },
      });
      expect(result.success).toBe(true);
    });

    it('should accept a policy with multiple fields', () => {
      const result = authoritiesPolicySchema.safeParse({
        roles: { any: ['admin'] },
        permissions: { all: ['users:delete'] },
        operator: 'AND',
      });
      expect(result.success).toBe(true);
    });

    it('should accept nested allOf combinator', () => {
      const result = authoritiesPolicySchema.safeParse({
        allOf: [
          { roles: { any: ['admin'] } },
          { permissions: { all: ['users:write'] } },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept nested anyOf combinator', () => {
      const result = authoritiesPolicySchema.safeParse({
        anyOf: [
          { roles: { any: ['superadmin'] } },
          { allOf: [
            { roles: { any: ['manager'] } },
            { attributes: { match: { 'user.department': 'ops' } } },
          ]},
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept not combinator', () => {
      const result = authoritiesPolicySchema.safeParse({
        not: { roles: { any: ['banned'] } },
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty policy (no restrictions)', () => {
      const result = authoritiesPolicySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept policy with custom evaluators', () => {
      const result = authoritiesPolicySchema.safeParse({
        custom: { ipAllowList: { cidr: ['10.0.0.0/8'] } },
      });
      expect(result.success).toBe(true);
    });
  });

  // =============================================
  // Unified AuthoritiesMetadata Schema
  // =============================================

  describe('authoritiesMetadataSchema', () => {
    it('should accept a string (profile name)', () => {
      const result = authoritiesMetadataSchema.safeParse('admin');
      expect(result.success).toBe(true);
    });

    it('should accept a string array (multiple profiles)', () => {
      const result = authoritiesMetadataSchema.safeParse(['admin', 'matchTenant']);
      expect(result.success).toBe(true);
    });

    it('should accept a policy object', () => {
      const result = authoritiesMetadataSchema.safeParse({
        roles: { any: ['admin'] },
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty string', () => {
      expect(authoritiesMetadataSchema.safeParse('').success).toBe(false);
    });

    it('should reject empty array', () => {
      expect(authoritiesMetadataSchema.safeParse([]).success).toBe(false);
    });
  });

  // =============================================
  // Claims Mapping Schema
  // =============================================

  describe('authoritiesClaimsMappingSchema', () => {
    it('should accept a valid mapping', () => {
      const result = authoritiesClaimsMappingSchema.safeParse({
        roles: 'realm_access.roles',
        permissions: 'scope',
      });
      expect(result.success).toBe(true);
    });

    it('should accept mapping with custom fields', () => {
      const result = authoritiesClaimsMappingSchema.safeParse({
        roles: 'groups',
        tenantId: 'org_id',
      });
      expect(result.success).toBe(true);
    });
  });

  // =============================================
  // AuthoritiesConfig Schema
  // =============================================

  describe('authoritiesConfigSchema', () => {
    it('should accept full config with claimsMapping and profiles', () => {
      const result = authoritiesConfigSchema.safeParse({
        claimsMapping: { roles: 'realm_access.roles' },
        profiles: {
          admin: { roles: { any: ['admin'] } },
          authenticated: { attributes: { conditions: [{ path: 'user.sub', op: 'exists', value: true }] } },
        },
      });
      expect(result.success).toBe(true);
    });

    it('should accept config with only profiles', () => {
      const result = authoritiesConfigSchema.safeParse({
        profiles: {
          admin: { roles: { any: ['admin'] } },
        },
      });
      expect(result.success).toBe(true);
    });

    it('should accept config with only claimsMapping', () => {
      const result = authoritiesConfigSchema.safeParse({
        claimsMapping: { roles: 'roles' },
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty config', () => {
      const result = authoritiesConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
