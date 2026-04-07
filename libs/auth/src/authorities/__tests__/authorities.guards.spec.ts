import { AuthoritiesEngine } from '../authorities.engine';
import { AuthoritiesProfileRegistry, AuthoritiesEvaluatorRegistry } from '../authorities.registry';
import type { AuthoritiesEvaluationContext, RelationshipResolver, AuthorityGuardFn } from '../authorities.types';

function createCtx(overrides: Partial<AuthoritiesEvaluationContext> = {}): AuthoritiesEvaluationContext {
  const noopResolver: RelationshipResolver = { check: async () => false };
  return {
    user: { sub: 'user-1', roles: ['admin'], permissions: ['read'], claims: {} },
    input: { tenantId: 'tenant-42' },
    env: {},
    relationships: noopResolver,
    ...overrides,
  };
}

function createEngine(): AuthoritiesEngine {
  return new AuthoritiesEngine(new AuthoritiesProfileRegistry(), new AuthoritiesEvaluatorRegistry());
}

describe('Authority Guards', () => {
  it('should grant when all guards return true', async () => {
    const engine = createEngine();
    const result = await engine.evaluate(
      {
        guards: [
          async () => true,
          async () => true,
        ],
      },
      createCtx(),
    );
    expect(result.granted).toBe(true);
    expect(result.evaluatedPolicies).toContain('guards');
  });

  it('should deny when a guard returns false', async () => {
    const engine = createEngine();
    const result = await engine.evaluate(
      {
        guards: [
          async () => true,
          async () => false,
        ],
      },
      createCtx(),
    );
    expect(result.granted).toBe(false);
    expect(result.deniedBy).toContain('guards[1]');
  });

  it('should deny with custom message when guard returns string', async () => {
    const engine = createEngine();
    const result = await engine.evaluate(
      {
        guards: [
          async () => 'tenant not in allowlist',
        ],
      },
      createCtx(),
    );
    expect(result.granted).toBe(false);
    expect(result.deniedBy).toContain('tenant not in allowlist');
    expect(result.denial?.kind).toBe('custom');
    expect(result.denial?.path).toBe('guards[0]');
  });

  it('should short-circuit on first failing guard', async () => {
    let secondGuardCalled = false;
    const engine = createEngine();
    const result = await engine.evaluate(
      {
        guards: [
          async () => false,
          async () => { secondGuardCalled = true; return true; },
        ],
      },
      createCtx(),
    );
    expect(result.granted).toBe(false);
    expect(secondGuardCalled).toBe(false);
  });

  it('should grant with empty guards array', async () => {
    const engine = createEngine();
    const result = await engine.evaluate({ guards: [] }, createCtx());
    expect(result.granted).toBe(true);
  });

  it('should combine guards with RBAC (AND semantics)', async () => {
    const engine = createEngine();

    // Both pass
    const both = await engine.evaluate(
      {
        roles: { any: ['admin'] },
        guards: [async () => true],
      },
      createCtx(),
    );
    expect(both.granted).toBe(true);

    // RBAC passes, guard fails → denied
    const guardFails = await engine.evaluate(
      {
        roles: { any: ['admin'] },
        guards: [async () => 'subscription expired'],
      },
      createCtx(),
    );
    expect(guardFails.granted).toBe(false);
    expect(guardFails.deniedBy).toContain('subscription expired');

    // Guard passes, RBAC fails → denied
    const rbacFails = await engine.evaluate(
      {
        roles: { any: ['superadmin'] },
        guards: [async () => true],
      },
      createCtx(),
    );
    expect(rbacFails.granted).toBe(false);
    expect(rbacFails.deniedBy).toContain('roles');
  });

  it('should receive full evaluation context in guard', async () => {
    const engine = createEngine();
    let receivedCtx: AuthoritiesEvaluationContext | undefined;

    await engine.evaluate(
      {
        guards: [
          async (ctx) => { receivedCtx = ctx; return true; },
        ],
      },
      createCtx({ input: { tenantId: 'test-tenant' } }),
    );

    expect(receivedCtx).toBeDefined();
    expect(receivedCtx?.user.sub).toBe('user-1');
    expect(receivedCtx?.input['tenantId']).toBe('test-tenant');
  });

  it('should work with async DB/Redis-like operations', async () => {
    // Simulate async Redis sismember check
    const allowedTenants = new Set(['tenant-42', 'tenant-99']);
    const guard: AuthorityGuardFn = async (ctx) => {
      const tid = ctx.input['tenantId'] as string;
      // Simulate async I/O
      await new Promise((resolve) => setTimeout(resolve, 1));
      return allowedTenants.has(tid) ? true : `tenant '${tid}' not in allowlist`;
    };

    const engine = createEngine();

    // Allowed tenant
    const allowed = await engine.evaluate(
      { guards: [guard] },
      createCtx({ input: { tenantId: 'tenant-42' } }),
    );
    expect(allowed.granted).toBe(true);

    // Denied tenant
    const denied = await engine.evaluate(
      { guards: [guard] },
      createCtx({ input: { tenantId: 'tenant-unknown' } }),
    );
    expect(denied.granted).toBe(false);
    expect(denied.deniedBy).toContain('tenant-unknown');
  });
});
