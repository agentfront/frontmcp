/**
 * JobPermissionGuard — the rule semantics behind GHSA-58v2-gpcc-jmqv.
 *
 * The guard existed but was never called, and had never had a test. These cases
 * pin both halves of its contract:
 *
 *  - permissive at the edges: no rules, or no rule for the action, means allow.
 *    That is the documented behaviour and changing it would break every server
 *    that declares permissions for only some actions.
 *  - strict in the middle: once a rule matches the action it must pass, ALL
 *    matching rules must pass, and roles/scopes within one rule are ANY-of.
 *
 * Claim resolution is covered too, because the original implementation read
 * `authInfo['roles']` — a field AuthInfo does not have — so wiring it up
 * unchanged would have denied every permissioned job.
 */
import type { JobPermission } from '../../common/metadata/job.metadata';
import { JobPermissionGuard } from '../job-permission.guard';

const adminRule: JobPermission[] = [{ action: 'execute', roles: ['admin'] }];

describe('JobPermissionGuard.check — permissive edges', () => {
  it('allows when no permissions are declared', async () => {
    await expect(JobPermissionGuard.check(undefined, 'execute', {})).resolves.toBe(true);
    await expect(JobPermissionGuard.check([], 'execute', {})).resolves.toBe(true);
  });

  it('allows when no rule targets the requested action', async () => {
    await expect(JobPermissionGuard.check(adminRule, 'list', {})).resolves.toBe(true);
  });
});

describe('JobPermissionGuard.check — role rules', () => {
  it('denies a caller with no identity at all', async () => {
    await expect(JobPermissionGuard.check(adminRule, 'execute', undefined)).resolves.toBe(false);
    await expect(JobPermissionGuard.check(adminRule, 'execute', {})).resolves.toBe(false);
  });

  it('reads roles from user.roles', async () => {
    await expect(JobPermissionGuard.check(adminRule, 'execute', { user: { roles: ['admin'] } })).resolves.toBe(true);
    await expect(JobPermissionGuard.check(adminRule, 'execute', { user: { roles: ['viewer'] } })).resolves.toBe(false);
  });

  it('reads roles from verified token claims', async () => {
    await expect(JobPermissionGuard.check(adminRule, 'execute', { claims: { roles: ['admin'] } })).resolves.toBe(true);
  });

  it('reads roles from the legacy authorization projection', async () => {
    const authInfo = { extra: { authorization: { claims: { roles: ['admin'] } } } };
    await expect(JobPermissionGuard.check(adminRule, 'execute', authInfo)).resolves.toBe(true);
  });

  it('does NOT read a bare top-level roles field (it is not part of AuthInfo)', async () => {
    await expect(JobPermissionGuard.check(adminRule, 'execute', { roles: ['admin'] })).resolves.toBe(false);
  });

  it('treats a rule with several roles as any-of', async () => {
    const rule: JobPermission[] = [{ action: 'execute', roles: ['admin', 'ops'] }];
    await expect(JobPermissionGuard.check(rule, 'execute', { user: { roles: ['ops'] } })).resolves.toBe(true);
  });

  it('requires every matching rule to pass', async () => {
    const rules: JobPermission[] = [
      { action: 'execute', roles: ['admin'] },
      { action: 'execute', scopes: ['jobs:run'] },
    ];
    const admin = { user: { roles: ['admin'] } };
    await expect(JobPermissionGuard.check(rules, 'execute', admin)).resolves.toBe(false);
    await expect(JobPermissionGuard.check(rules, 'execute', { ...admin, scopes: ['jobs:run'] })).resolves.toBe(true);
  });
});

describe('JobPermissionGuard.check — scope rules', () => {
  const scopeRule: JobPermission[] = [{ action: 'execute', scopes: ['reports:run'] }];

  it('reads the verified scope set from AuthInfo', async () => {
    await expect(JobPermissionGuard.check(scopeRule, 'execute', { scopes: ['reports:run'] })).resolves.toBe(true);
    await expect(JobPermissionGuard.check(scopeRule, 'execute', { scopes: ['other'] })).resolves.toBe(false);
  });

  it('falls back to a space-delimited scope claim', async () => {
    const authInfo = { claims: { scope: 'openid reports:run' } };
    await expect(JobPermissionGuard.check(scopeRule, 'execute', authInfo)).resolves.toBe(true);
  });

  it('denies when no scopes are present anywhere', async () => {
    await expect(JobPermissionGuard.check(scopeRule, 'execute', {})).resolves.toBe(false);
  });
});

describe('JobPermissionGuard.check — custom rules', () => {
  it('denies when the custom rule returns false', async () => {
    const rule: JobPermission[] = [{ action: 'execute', custom: () => false }];
    await expect(JobPermissionGuard.check(rule, 'execute', { user: { sub: 'u' } })).resolves.toBe(false);
  });

  it('allows when the custom rule returns true, and receives the raw AuthInfo', async () => {
    const custom = jest.fn(async (authInfo: Partial<Record<string, unknown>>) => authInfo['sessionId'] === 'live');
    const rule: JobPermission[] = [{ action: 'execute', custom }];

    await expect(JobPermissionGuard.check(rule, 'execute', { sessionId: 'live' })).resolves.toBe(true);
    expect(custom).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'live' }));
  });

  it('evaluates roles before the custom rule and short-circuits on denial', async () => {
    const custom = jest.fn(() => true);
    const rule: JobPermission[] = [{ action: 'execute', roles: ['admin'], custom }];

    await expect(JobPermissionGuard.check(rule, 'execute', { user: { roles: ['viewer'] } })).resolves.toBe(false);
    expect(custom).not.toHaveBeenCalled();
  });
});

describe('JobPermissionGuard.check — authorities claimsMapping', () => {
  it('honours the scope claims mapping when one is configured', async () => {
    // A server that told FrontMCP where its roles live must not have the
    // permission check quietly look somewhere else.
    const contextBuilder = {
      build: () => ({ user: { sub: 'u', roles: ['admin'], permissions: [], claims: {} } }),
    } as never;

    const authInfo = { user: { sub: 'u' }, claims: { 'https://acme/roles': ['admin'] } };
    await expect(JobPermissionGuard.check(adminRule, 'execute', authInfo, contextBuilder)).resolves.toBe(true);
  });
});
