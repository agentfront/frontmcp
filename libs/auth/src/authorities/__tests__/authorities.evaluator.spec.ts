import {
  evaluateRbacRoles,
  evaluateRbacPermissions,
  evaluateAbac,
  evaluateRebac,
  resolveResourceId,
} from '../authorities.evaluator';
import type { AuthoritiesEvaluationContext, RelationshipResolver } from '../authorities.types';

function createCtx(overrides: Partial<AuthoritiesEvaluationContext> = {}): AuthoritiesEvaluationContext {
  const noopResolver: RelationshipResolver = { check: async () => false };
  return {
    user: { sub: 'user-1', roles: [], permissions: [], claims: {} },
    input: {},
    env: {},
    relationships: noopResolver,
    ...overrides,
  };
}

describe('RBAC Roles Evaluator', () => {
  it('should grant when user has all required roles', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: ['admin', 'manager'], permissions: [], claims: {} } });
    const result = evaluateRbacRoles({ all: ['admin', 'manager'] }, ctx);
    expect(result.granted).toBe(true);
  });

  it('should deny when user is missing a required role from "all"', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: ['admin'], permissions: [], claims: {} } });
    const result = evaluateRbacRoles({ all: ['admin', 'superadmin'] }, ctx);
    expect(result.granted).toBe(false);
    expect(result.deniedBy).toContain('superadmin');
    expect(result.denial).toEqual({ kind: 'roles', path: 'roles.all', missing: ['superadmin'] });
  });

  it('should grant when user has any of the required roles', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: ['viewer'], permissions: [], claims: {} } });
    const result = evaluateRbacRoles({ any: ['admin', 'viewer'] }, ctx);
    expect(result.granted).toBe(true);
  });

  it('should deny when user has none of the "any" roles', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: ['guest'], permissions: [], claims: {} } });
    const result = evaluateRbacRoles({ any: ['admin', 'manager'] }, ctx);
    expect(result.granted).toBe(false);
    expect(result.deniedBy).toContain('roles.any');
    expect(result.denial).toEqual({ kind: 'roles', path: 'roles.any', missing: ['admin', 'manager'] });
  });

  it('should grant when both all and any are satisfied', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: ['admin', 'reviewer'], permissions: [], claims: {} } });
    const result = evaluateRbacRoles({ all: ['admin'], any: ['reviewer', 'approver'] }, ctx);
    expect(result.granted).toBe(true);
  });

  it('should deny when all passes but any fails', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: ['admin'], permissions: [], claims: {} } });
    const result = evaluateRbacRoles({ all: ['admin'], any: ['reviewer', 'approver'] }, ctx);
    expect(result.granted).toBe(false);
  });

  it('should grant when only all is specified and satisfied', () => {
    const result = evaluateRbacRoles(
      { all: ['editor'] },
      createCtx({ user: { sub: 'u1', roles: ['editor', 'admin'], permissions: [], claims: {} } }),
    );
    expect(result.granted).toBe(true);
  });
});

describe('RBAC Permissions Evaluator', () => {
  it('should grant when user has all required permissions', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: [], permissions: ['users:read', 'users:write'], claims: {} } });
    const result = evaluateRbacPermissions({ all: ['users:read', 'users:write'] }, ctx);
    expect(result.granted).toBe(true);
  });

  it('should deny when user is missing a permission from "all"', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: [], permissions: ['users:read'], claims: {} } });
    const result = evaluateRbacPermissions({ all: ['users:read', 'users:delete'] }, ctx);
    expect(result.granted).toBe(false);
    expect(result.deniedBy).toContain('users:delete');
    expect(result.denial).toEqual({ kind: 'permissions', path: 'permissions.all', missing: ['users:delete'] });
  });

  it('should grant when user has any of the permissions', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: [], permissions: ['users:delete'], claims: {} } });
    const result = evaluateRbacPermissions({ any: ['users:read', 'users:delete'] }, ctx);
    expect(result.granted).toBe(true);
  });

  it('should deny when user has none of the "any" permissions', () => {
    const ctx = createCtx({ user: { sub: 'u1', roles: [], permissions: ['posts:read'], claims: {} } });
    const result = evaluateRbacPermissions({ any: ['users:read', 'users:write'] }, ctx);
    expect(result.granted).toBe(false);
    expect(result.denial).toEqual({ kind: 'permissions', path: 'permissions.any', missing: ['users:read', 'users:write'] });
  });
});

describe('ABAC Evaluator', () => {
  describe('match', () => {
    it('should grant when all match conditions are met', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { department: 'engineering' } },
      });
      const result = evaluateAbac({ match: { 'claims.department': 'engineering' } }, ctx);
      expect(result.granted).toBe(true);
    });

    it('should deny when a match condition fails', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { department: 'sales' } },
      });
      const result = evaluateAbac({ match: { 'claims.department': 'engineering' } }, ctx);
      expect(result.granted).toBe(false);
      expect(result.deniedBy).toContain('claims.department');
      expect(result.denial).toEqual({
        kind: 'attributes',
        path: 'attributes.match',
        expected: 'engineering',
        actual: 'sales',
      });
    });

    it('should resolve dynamic values with fromInput', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { org_id: 'org-42' } },
        input: { tenantId: 'org-42' },
      });
      const result = evaluateAbac({
        match: { 'claims.org_id': { fromInput: 'tenantId' } },
      }, ctx);
      expect(result.granted).toBe(true);
    });
  });

  describe('conditions', () => {
    it('should handle eq operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { level: 5 } },
      });
      const result = evaluateAbac({
        conditions: [{ path: 'claims.level', op: 'eq', value: 5 }],
      }, ctx);
      expect(result.granted).toBe(true);
    });

    it('should handle neq operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { status: 'active' } },
      });
      const result = evaluateAbac({
        conditions: [{ path: 'claims.status', op: 'neq', value: 'banned' }],
      }, ctx);
      expect(result.granted).toBe(true);
    });

    it('should handle in operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { region: 'us-west' } },
      });
      const result = evaluateAbac({
        conditions: [{ path: 'claims.region', op: 'in', value: ['us-east', 'us-west', 'eu-west'] }],
      }, ctx);
      expect(result.granted).toBe(true);
    });

    it('should handle notIn operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { region: 'us-west' } },
      });
      const result = evaluateAbac({
        conditions: [{ path: 'claims.region', op: 'notIn', value: ['cn-north', 'cn-east'] }],
      }, ctx);
      expect(result.granted).toBe(true);
    });

    it('should handle gt operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { level: 10 } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.level', op: 'gt', value: 5 }] }, ctx).granted).toBe(true);
      expect(evaluateAbac({ conditions: [{ path: 'claims.level', op: 'gt', value: 10 }] }, ctx).granted).toBe(false);
    });

    it('should handle gte operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { level: 10 } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.level', op: 'gte', value: 10 }] }, ctx).granted).toBe(true);
      expect(evaluateAbac({ conditions: [{ path: 'claims.level', op: 'gte', value: 11 }] }, ctx).granted).toBe(false);
    });

    it('should handle lt and lte operators', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { level: 3 } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.level', op: 'lt', value: 5 }] }, ctx).granted).toBe(true);
      expect(evaluateAbac({ conditions: [{ path: 'claims.level', op: 'lte', value: 3 }] }, ctx).granted).toBe(true);
      expect(evaluateAbac({ conditions: [{ path: 'claims.level', op: 'lt', value: 3 }] }, ctx).granted).toBe(false);
    });

    it('should handle contains operator for strings', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { email: 'user@example.com' } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.email', op: 'contains', value: '@example.com' }] }, ctx).granted).toBe(true);
    });

    it('should handle contains operator for arrays', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { tags: ['vip', 'beta'] } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.tags', op: 'contains', value: 'vip' }] }, ctx).granted).toBe(true);
    });

    it('should handle startsWith operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { email: 'admin@corp.com' } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.email', op: 'startsWith', value: 'admin' }] }, ctx).granted).toBe(true);
    });

    it('should handle endsWith operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { email: 'admin@corp.com' } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.email', op: 'endsWith', value: '@corp.com' }] }, ctx).granted).toBe(true);
    });

    it('should handle exists operator (true)', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { verified: true } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.verified', op: 'exists', value: true }] }, ctx).granted).toBe(true);
    });

    it('should handle exists operator (false = must not exist)', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: {} },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.missing', op: 'exists', value: false }] }, ctx).granted).toBe(true);
    });

    it('should handle matches (regex) operator', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { email: 'user@acme.com' } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.email', op: 'matches', value: '^.+@acme\\.com$' }] }, ctx).granted).toBe(true);
      expect(evaluateAbac({ conditions: [{ path: 'claims.email', op: 'matches', value: '^.+@evil\\.com$' }] }, ctx).granted).toBe(false);
    });

    it('should handle invalid regex gracefully', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { email: 'test' } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.email', op: 'matches', value: '[invalid' }] }, ctx).granted).toBe(false);
    });

    it('should resolve dot-path into nested user claims', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { org: { id: 'org-42' } } },
      });
      expect(evaluateAbac({ conditions: [{ path: 'claims.org.id', op: 'eq', value: 'org-42' }] }, ctx).granted).toBe(true);
    });

    it('should resolve input paths', () => {
      const ctx = createCtx({ input: { region: 'us-west' } });
      expect(evaluateAbac({ conditions: [{ path: 'input.region', op: 'eq', value: 'us-west' }] }, ctx).granted).toBe(true);
    });

    it('should resolve env paths', () => {
      const ctx = createCtx({ env: { NODE_ENV: 'production' } });
      expect(evaluateAbac({ conditions: [{ path: 'env.NODE_ENV', op: 'eq', value: 'production' }] }, ctx).granted).toBe(true);
    });

    it('should deny when condition fails', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { level: 2 } },
      });
      const result = evaluateAbac({ conditions: [{ path: 'claims.level', op: 'gte', value: 5 }] }, ctx);
      expect(result.granted).toBe(false);
      expect(result.deniedBy).toContain('claims.level');
      expect(result.denial).toEqual({
        kind: 'attributes',
        path: 'attributes.conditions[0]',
        expected: 5,
        actual: 2,
      });
    });

    it('should evaluate dynamic value ref in conditions', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { tenantId: 'tenant-1' } },
        input: { tenantId: 'tenant-1' },
      });
      const result = evaluateAbac({
        conditions: [{ path: 'claims.tenantId', op: 'eq', value: { fromInput: 'tenantId' } }],
      }, ctx);
      expect(result.granted).toBe(true);
    });
  });
});

describe('ReBAC Evaluator', () => {
  describe('resolveResourceId', () => {
    it('should return literal string', () => {
      const ctx = createCtx();
      expect(resolveResourceId('site-123', ctx)).toBe('site-123');
    });

    it('should resolve fromInput', () => {
      const ctx = createCtx({ input: { siteId: 'site-456' } });
      expect(resolveResourceId({ fromInput: 'siteId' }, ctx)).toBe('site-456');
    });

    it('should resolve fromClaims', () => {
      const ctx = createCtx({
        user: { sub: 'u1', roles: [], permissions: [], claims: { orgId: 'org-789' } },
      });
      expect(resolveResourceId({ fromClaims: 'orgId' }, ctx)).toBe('org-789');
    });

    it('should return undefined when fromInput field is missing', () => {
      const ctx = createCtx({ input: {} });
      expect(resolveResourceId({ fromInput: 'missing' }, ctx)).toBeUndefined();
    });

    it('should return undefined when fromClaims field is missing', () => {
      const ctx = createCtx();
      expect(resolveResourceId({ fromClaims: 'missing' }, ctx)).toBeUndefined();
    });
  });

  describe('evaluateRebac', () => {
    it('should grant when relationship resolver returns true', async () => {
      const resolver: RelationshipResolver = {
        check: async (type, resource, resourceId, userSub) => {
          return type === 'member' && resource === 'site' && resourceId === 'site-1' && userSub === 'user-1';
        },
      };
      const ctx = createCtx({ relationships: resolver, input: { siteId: 'site-1' } });
      const result = await evaluateRebac(
        { type: 'member', resource: 'site', resourceId: { fromInput: 'siteId' } },
        ctx,
      );
      expect(result.granted).toBe(true);
    });

    it('should deny when relationship resolver returns false', async () => {
      const resolver: RelationshipResolver = { check: async () => false };
      const ctx = createCtx({ relationships: resolver, input: { siteId: 'site-1' } });
      const result = await evaluateRebac(
        { type: 'owner', resource: 'site', resourceId: { fromInput: 'siteId' } },
        ctx,
      );
      expect(result.granted).toBe(false);
      expect(result.deniedBy).toContain('owner');
      expect(result.denial).toEqual({
        kind: 'relationships',
        path: 'relationships',
        expected: 'owner:site:site-1',
      });
    });

    it('should deny when resourceId cannot be resolved', async () => {
      const ctx = createCtx({ input: {} });
      const result = await evaluateRebac(
        { type: 'member', resource: 'site', resourceId: { fromInput: 'missing' } },
        ctx,
      );
      expect(result.granted).toBe(false);
      expect(result.deniedBy).toContain('could not resolve');
      expect(result.denial).toEqual({
        kind: 'relationships',
        path: 'relationships',
        expected: 'site:resourceId',
        actual: undefined,
      });
    });

    it('should evaluate array of policies with AND semantics', async () => {
      let callCount = 0;
      const resolver: RelationshipResolver = {
        check: async () => {
          callCount++;
          return true;
        },
      };
      const ctx = createCtx({ relationships: resolver, input: { siteId: 'site-1', orgId: 'org-1' } });
      const result = await evaluateRebac(
        [
          { type: 'member', resource: 'site', resourceId: { fromInput: 'siteId' } },
          { type: 'member', resource: 'org', resourceId: { fromInput: 'orgId' } },
        ],
        ctx,
      );
      expect(result.granted).toBe(true);
      expect(callCount).toBe(2);
    });

    it('should short-circuit array on first failure', async () => {
      let callCount = 0;
      const resolver: RelationshipResolver = {
        check: async () => {
          callCount++;
          return false;
        },
      };
      const ctx = createCtx({ relationships: resolver, input: { siteId: 'site-1', orgId: 'org-1' } });
      const result = await evaluateRebac(
        [
          { type: 'member', resource: 'site', resourceId: { fromInput: 'siteId' } },
          { type: 'member', resource: 'org', resourceId: { fromInput: 'orgId' } },
        ],
        ctx,
      );
      expect(result.granted).toBe(false);
      expect(callCount).toBe(1);
    });
  });
});
