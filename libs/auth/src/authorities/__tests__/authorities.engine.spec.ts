import { AuthoritiesEngine } from '../authorities.engine';
import { AuthoritiesProfileRegistry, AuthoritiesEvaluatorRegistry } from '../authorities.registry';
import type {
  AuthoritiesEvaluationContext,
  AuthoritiesPolicyMetadata,
  RelationshipResolver,
  AuthoritiesEvaluator,
} from '../authorities.types';

function createCtx(overrides: Partial<AuthoritiesEvaluationContext> = {}): AuthoritiesEvaluationContext {
  const noopResolver: RelationshipResolver = { check: async () => false };
  return {
    user: { sub: 'user-1', roles: ['admin'], permissions: ['users:read'], claims: { department: 'eng' } },
    input: {},
    env: {},
    relationships: noopResolver,
    ...overrides,
  };
}

function createEngine(
  profiles: Record<string, AuthoritiesPolicyMetadata> = {},
  evaluators: Record<string, AuthoritiesEvaluator> = {},
): AuthoritiesEngine {
  const profileRegistry = new AuthoritiesProfileRegistry();
  profileRegistry.registerAll(profiles);
  const evaluatorRegistry = new AuthoritiesEvaluatorRegistry();
  evaluatorRegistry.registerAll(evaluators);
  return new AuthoritiesEngine(profileRegistry, evaluatorRegistry);
}

describe('AuthoritiesEngine', () => {
  // =============================================
  // Profile Resolution
  // =============================================

  describe('profile resolution', () => {
    it('should resolve and evaluate a string profile', async () => {
      const engine = createEngine({ admin: { roles: { any: ['admin'] } } });
      const result = await engine.evaluate('admin', createCtx());
      expect(result.granted).toBe(true);
      expect(result.evaluatedPolicies).toContain('profile:admin');
    });

    it('should deny when profile policy fails', async () => {
      const engine = createEngine({ superadmin: { roles: { all: ['superadmin'] } } });
      const result = await engine.evaluate('superadmin', createCtx());
      expect(result.granted).toBe(false);
      expect(result.deniedBy).toContain('profile:superadmin');
    });

    it('should deny when profile is not registered', async () => {
      const engine = createEngine({});
      const result = await engine.evaluate('unknown', createCtx());
      expect(result.granted).toBe(false);
      expect(result.deniedBy).toContain("profile 'unknown' is not registered");
    });

    it('should evaluate string array as AND (all profiles must pass)', async () => {
      const engine = createEngine({
        admin: { roles: { any: ['admin'] } },
        reader: { permissions: { any: ['users:read'] } },
      });
      const result = await engine.evaluate(['admin', 'reader'], createCtx());
      expect(result.granted).toBe(true);
    });

    it('should deny string array when any profile fails', async () => {
      const engine = createEngine({
        admin: { roles: { any: ['admin'] } },
        superadmin: { roles: { all: ['superadmin'] } },
      });
      const result = await engine.evaluate(['admin', 'superadmin'], createCtx());
      expect(result.granted).toBe(false);
    });
  });

  // =============================================
  // Inline Policy Evaluation
  // =============================================

  describe('inline policy', () => {
    it('should grant when roles policy passes', async () => {
      const engine = createEngine();
      const result = await engine.evaluate({ roles: { any: ['admin'] } }, createCtx());
      expect(result.granted).toBe(true);
    });

    it('should grant when permissions policy passes', async () => {
      const engine = createEngine();
      const result = await engine.evaluate({ permissions: { any: ['users:read'] } }, createCtx());
      expect(result.granted).toBe(true);
    });

    it('should grant when ABAC attributes pass', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        { attributes: { match: { 'claims.department': 'eng' } } },
        createCtx(),
      );
      expect(result.granted).toBe(true);
    });

    it('should evaluate empty policy as granted (no restrictions)', async () => {
      const engine = createEngine();
      const result = await engine.evaluate({}, createCtx());
      expect(result.granted).toBe(true);
    });
  });

  // =============================================
  // AND/OR Operators
  // =============================================

  describe('operator', () => {
    it('should use AND by default (all fields must pass)', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        { roles: { any: ['admin'] }, permissions: { all: ['users:delete'] } },
        createCtx(),
      );
      expect(result.granted).toBe(false); // user has users:read, not users:delete
    });

    it('should use OR when specified (any field can pass)', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        { roles: { any: ['admin'] }, permissions: { all: ['users:delete'] }, operator: 'OR' },
        createCtx(),
      );
      expect(result.granted).toBe(true); // roles passes, so OR succeeds
    });

    it('should deny OR when all fields fail', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        { roles: { any: ['superadmin'] }, permissions: { all: ['users:delete'] }, operator: 'OR' },
        createCtx(),
      );
      expect(result.granted).toBe(false);
    });
  });

  // =============================================
  // Combinators
  // =============================================

  describe('allOf combinator', () => {
    it('should grant when all nested policies pass', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        {
          allOf: [
            { roles: { any: ['admin'] } },
            { permissions: { any: ['users:read'] } },
          ],
        },
        createCtx(),
      );
      expect(result.granted).toBe(true);
    });

    it('should deny when any nested policy fails', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        {
          allOf: [
            { roles: { any: ['admin'] } },
            { roles: { all: ['superadmin'] } },
          ],
        },
        createCtx(),
      );
      expect(result.granted).toBe(false);
    });
  });

  describe('anyOf combinator', () => {
    it('should grant when at least one nested policy passes', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        {
          anyOf: [
            { roles: { all: ['superadmin'] } },
            { roles: { any: ['admin'] } },
          ],
        },
        createCtx(),
      );
      expect(result.granted).toBe(true);
    });

    it('should deny when all nested policies fail', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        {
          anyOf: [
            { roles: { all: ['superadmin'] } },
            { permissions: { all: ['admin:all'] } },
          ],
        },
        createCtx(),
      );
      expect(result.granted).toBe(false);
    });
  });

  describe('not combinator', () => {
    it('should grant when inner policy is denied (negation)', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        { not: { roles: { any: ['banned'] } } },
        createCtx(),
      );
      expect(result.granted).toBe(true);
    });

    it('should deny when inner policy is granted (negation)', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        { not: { roles: { any: ['admin'] } } },
        createCtx(),
      );
      expect(result.granted).toBe(false);
      expect(result.deniedBy).toContain('not');
    });
  });

  describe('nested combinators', () => {
    it('should handle anyOf containing allOf', async () => {
      const engine = createEngine();
      const ctx = createCtx({
        user: { sub: 'u1', roles: ['manager'], permissions: [], claims: { department: 'ops' } },
      });
      const result = await engine.evaluate(
        {
          anyOf: [
            { roles: { any: ['superadmin'] } },
            {
              allOf: [
                { roles: { any: ['manager'] } },
                { attributes: { match: { 'claims.department': 'ops' } } },
              ],
            },
          ],
        },
        ctx,
      );
      expect(result.granted).toBe(true);
    });
  });

  // =============================================
  // Custom Evaluators
  // =============================================

  describe('custom evaluators', () => {
    it('should dispatch to registered custom evaluator', async () => {
      const ipEvaluator: AuthoritiesEvaluator = {
        name: 'ipAllowList',
        evaluate: async (policy) => {
          const { allowed } = policy as { allowed: boolean };
          return {
            granted: allowed,
            evaluatedPolicies: ['custom.ipAllowList'],
            deniedBy: allowed ? undefined : 'IP not in allowlist',
          };
        },
      };
      const engine = createEngine({}, { ipAllowList: ipEvaluator });

      const granted = await engine.evaluate(
        { custom: { ipAllowList: { allowed: true } } },
        createCtx(),
      );
      expect(granted.granted).toBe(true);

      const denied = await engine.evaluate(
        { custom: { ipAllowList: { allowed: false } } },
        createCtx(),
      );
      expect(denied.granted).toBe(false);
    });

    it('should deny when custom evaluator is not registered', async () => {
      const engine = createEngine();
      const result = await engine.evaluate(
        { custom: { unknownEval: { config: true } } },
        createCtx(),
      );
      expect(result.granted).toBe(false);
      expect(result.deniedBy).toContain("custom evaluator 'unknownEval' is not registered");
    });
  });

  // =============================================
  // ReBAC Integration
  // =============================================

  describe('ReBAC via engine', () => {
    it('should delegate to relationship resolver', async () => {
      const resolver: RelationshipResolver = {
        check: async (type, resource, resourceId, userSub) =>
          type === 'member' && resource === 'org' && resourceId === 'org-1' && userSub === 'user-1',
      };
      const engine = createEngine();
      const ctx = createCtx({
        relationships: resolver,
        input: { orgId: 'org-1' },
      });
      const result = await engine.evaluate(
        { relationships: { type: 'member', resource: 'org', resourceId: { fromInput: 'orgId' } } },
        ctx,
      );
      expect(result.granted).toBe(true);
    });
  });
});
