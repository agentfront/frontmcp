import { type AuthoritiesClaimsMapping } from '../../authorities/authorities.profiles';
import { type FrontMcpAuthContext } from '../frontmcp-auth-context';
import { buildAuthContext } from '../frontmcp-auth-context.factory';
import { FrontMcpAuthContextImpl, type AuthContextSourceInfo } from '../frontmcp-auth-context.impl';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal authenticated source. */
function authenticatedSource(overrides: Partial<AuthContextSourceInfo> = {}): AuthContextSourceInfo {
  return {
    user: { sub: 'user-123', name: 'Alice', email: 'alice@example.com', picture: 'https://example.com/alice.jpg' },
    scopes: ['openid', 'profile'],
    sessionId: 'sess-abc',
    ...overrides,
  };
}

// ===========================================================================
// FrontMcpAuthContextImpl — Construction
// ===========================================================================

describe('FrontMcpAuthContextImpl', () => {
  describe('construction from various AuthInfo shapes', () => {
    it('should construct with full user info', () => {
      const ctx = new FrontMcpAuthContextImpl(authenticatedSource());

      expect(ctx.user.sub).toBe('user-123');
      expect(ctx.user.name).toBe('Alice');
      expect(ctx.user.email).toBe('alice@example.com');
      expect(ctx.user.picture).toBe('https://example.com/alice.jpg');
      expect(ctx.isAnonymous).toBe(false);
      expect(ctx.sessionId).toBe('sess-abc');
      expect(ctx.scopes).toEqual(['openid', 'profile']);
    });

    it('should construct with minimal info (empty source)', () => {
      const ctx = new FrontMcpAuthContextImpl({});

      expect(ctx.user.sub).toBe('');
      expect(ctx.user.name).toBeUndefined();
      expect(ctx.user.email).toBeUndefined();
      expect(ctx.user.picture).toBeUndefined();
      expect(ctx.isAnonymous).toBe(true);
      expect(ctx.sessionId).toBe('');
      expect(ctx.scopes).toEqual([]);
      expect(ctx.roles).toEqual([]);
      expect(ctx.permissions).toEqual([]);
    });

    it('should construct with user but no scopes or session', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });

      expect(ctx.user.sub).toBe('u1');
      expect(ctx.isAnonymous).toBe(false);
      expect(ctx.scopes).toEqual([]);
      expect(ctx.sessionId).toBe('');
    });

    it('should construct with roles and permissions on user object', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['admin', 'editor'], permissions: ['read', 'write', 'delete'] },
      });

      expect(ctx.roles).toEqual(['admin', 'editor']);
      expect(ctx.permissions).toEqual(['read', 'write', 'delete']);
    });

    it('should handle non-string values in scopes array', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        scopes: ['read', 42 as unknown as string, 'write', null as unknown as string],
      });

      expect(ctx.scopes).toEqual(['read', 'write']);
    });

    it('should freeze the user object', () => {
      const ctx = new FrontMcpAuthContextImpl(authenticatedSource());

      expect(Object.isFrozen(ctx.user)).toBe(true);
    });

    it('should freeze scopes, roles, permissions, and claims', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['admin'], permissions: ['read'] },
        scopes: ['openid'],
      });

      expect(Object.isFrozen(ctx.scopes)).toBe(true);
      expect(Object.isFrozen(ctx.roles)).toBe(true);
      expect(Object.isFrozen(ctx.permissions)).toBe(true);
      expect(Object.isFrozen(ctx.claims)).toBe(true);
    });
  });

  // =========================================================================
  // Anonymous detection
  // =========================================================================

  describe('isAnonymous', () => {
    it('should be true when sub is empty string', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: '' } });
      expect(ctx.isAnonymous).toBe(true);
    });

    it('should be true when sub starts with "anon:"', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'anon:guest-42' } });
      expect(ctx.isAnonymous).toBe(true);
    });

    it('should be true when user is missing entirely', () => {
      const ctx = new FrontMcpAuthContextImpl({});
      expect(ctx.isAnonymous).toBe(true);
    });

    it('should be false for normal sub', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'user-123' } });
      expect(ctx.isAnonymous).toBe(false);
    });

    it('should be false when sub contains "anon" but does not start with "anon:"', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'not-anon:user' } });
      expect(ctx.isAnonymous).toBe(false);
    });
  });

  // =========================================================================
  // Mode detection
  // =========================================================================

  describe('mode', () => {
    it('should default to "authenticated" for non-anonymous users', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.mode).toBe('authenticated');
    });

    it('should be "public" when extra.isPublic is true', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        extra: { isPublic: true },
      });
      expect(ctx.mode).toBe('public');
    });

    it('should be "public" when user.anonymous is true', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'anon:x', anonymous: true } as AuthContextSourceInfo['user'],
      });
      expect(ctx.mode).toBe('public');
    });

    it('should use extra.authMode when present', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        extra: { authMode: 'orchestrated' },
      });
      expect(ctx.mode).toBe('orchestrated');
    });

    it('should use extra.authorization.mode when present', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        extra: { authorization: { mode: 'transparent' } },
      });
      expect(ctx.mode).toBe('transparent');
    });

    it('should prefer extra.authMode over extra.authorization.mode', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        extra: { authMode: 'orchestrated', authorization: { mode: 'transparent' } },
      });
      expect(ctx.mode).toBe('orchestrated');
    });
  });

  // =========================================================================
  // Claims
  // =========================================================================

  describe('claims', () => {
    it('should include user fields in claims', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', email: 'a@b.com', customField: 'value' },
      });
      expect(ctx.claims['sub']).toBe('u1');
      expect(ctx.claims['email']).toBe('a@b.com');
      expect(ctx.claims['customField']).toBe('value');
    });

    it('should merge extra.authorization.claims into claims', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        extra: {
          authorization: {
            claims: { org_id: 'org-42', plan: 'enterprise' },
          },
        },
      });
      expect(ctx.claims['org_id']).toBe('org-42');
      expect(ctx.claims['plan']).toBe('enterprise');
      expect(ctx.claims['sub']).toBe('u1');
    });

    it('should let user fields override authorization.claims on conflict', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'from-user' },
        extra: {
          authorization: {
            claims: { sub: 'from-claims', extra_claim: true },
          },
        },
      });
      // User fields take precedence (spread order: { ...authorizationClaims, ...user })
      expect(ctx.claims['sub']).toBe('from-user');
      expect(ctx.claims['extra_claim']).toBe(true);
    });
  });

  // =========================================================================
  // hasRole / hasPermission
  // =========================================================================

  describe('hasRole', () => {
    it('should return true for a role the user has', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['admin', 'editor'] },
      });
      expect(ctx.hasRole('admin')).toBe(true);
      expect(ctx.hasRole('editor')).toBe(true);
    });

    it('should return false for a role the user does not have', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['editor'] },
      });
      expect(ctx.hasRole('admin')).toBe(false);
    });

    it('should return false when no roles are present', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasRole('admin')).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('should return true for a permission the user has', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', permissions: ['read', 'write'] },
      });
      expect(ctx.hasPermission('read')).toBe(true);
      expect(ctx.hasPermission('write')).toBe(true);
    });

    it('should return false for a permission the user does not have', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', permissions: ['read'] },
      });
      expect(ctx.hasPermission('delete')).toBe(false);
    });

    it('should return false when no permissions are present', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasPermission('read')).toBe(false);
    });
  });

  describe('hasAllRoles', () => {
    it('should return true when user has all specified roles', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['admin', 'editor', 'viewer'] },
      });
      expect(ctx.hasAllRoles(['admin', 'editor'])).toBe(true);
    });

    it('should return false when some roles are missing', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['editor'] },
      });
      expect(ctx.hasAllRoles(['admin', 'editor'])).toBe(false);
    });

    it('should return true for an empty roles list', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAllRoles([])).toBe(true);
    });

    it('should return false when user has no roles but list is non-empty', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAllRoles(['admin'])).toBe(false);
    });
  });

  describe('hasAnyRole', () => {
    it('should return true when user has at least one specified role', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['editor'] },
      });
      expect(ctx.hasAnyRole(['admin', 'editor'])).toBe(true);
    });

    it('should return false when user has none of the specified roles', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['viewer'] },
      });
      expect(ctx.hasAnyRole(['admin', 'editor'])).toBe(false);
    });

    it('should return false for an empty roles list', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['admin'] },
      });
      expect(ctx.hasAnyRole([])).toBe(false);
    });

    it('should return false when user has no roles', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAnyRole(['admin'])).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true when user has all specified permissions', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', permissions: ['read', 'write', 'delete'] },
      });
      expect(ctx.hasAllPermissions(['read', 'write'])).toBe(true);
    });

    it('should return false when some permissions are missing', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', permissions: ['read'] },
      });
      expect(ctx.hasAllPermissions(['read', 'write'])).toBe(false);
    });

    it('should return true for an empty permissions list', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAllPermissions([])).toBe(true);
    });

    it('should return false when user has no permissions but list is non-empty', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAllPermissions(['read'])).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true when user has at least one specified permission', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', permissions: ['write'] },
      });
      expect(ctx.hasAnyPermission(['read', 'write'])).toBe(true);
    });

    it('should return false when user has none of the specified permissions', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', permissions: ['delete'] },
      });
      expect(ctx.hasAnyPermission(['read', 'write'])).toBe(false);
    });

    it('should return false for an empty permissions list', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', permissions: ['read'] },
      });
      expect(ctx.hasAnyPermission([])).toBe(false);
    });

    it('should return false when user has no permissions', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAnyPermission(['read'])).toBe(false);
    });
  });

  // =========================================================================
  // hasScope / hasAllScopes / hasAnyScope
  // =========================================================================

  describe('hasScope', () => {
    it('should return true for a scope in the session', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        scopes: ['openid', 'profile', 'email'],
      });
      expect(ctx.hasScope('openid')).toBe(true);
      expect(ctx.hasScope('profile')).toBe(true);
    });

    it('should return false for a scope not in the session', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        scopes: ['openid'],
      });
      expect(ctx.hasScope('admin')).toBe(false);
    });

    it('should return false when no scopes are present', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasScope('openid')).toBe(false);
    });
  });

  describe('hasAllScopes', () => {
    it('should return true when all scopes are present', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        scopes: ['openid', 'profile', 'email'],
      });
      expect(ctx.hasAllScopes(['openid', 'profile'])).toBe(true);
    });

    it('should return false when some scopes are missing', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        scopes: ['openid'],
      });
      expect(ctx.hasAllScopes(['openid', 'profile'])).toBe(false);
    });

    it('should return true for an empty scopes list', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAllScopes([])).toBe(true);
    });

    it('should return false when session has no scopes but list is non-empty', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAllScopes(['openid'])).toBe(false);
    });
  });

  describe('hasAnyScope', () => {
    it('should return true when at least one scope is present', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        scopes: ['openid', 'profile'],
      });
      expect(ctx.hasAnyScope(['profile', 'admin'])).toBe(true);
    });

    it('should return false when no scopes match', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        scopes: ['openid'],
      });
      expect(ctx.hasAnyScope(['profile', 'admin'])).toBe(false);
    });

    it('should return false for an empty scopes list', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        scopes: ['openid'],
      });
      expect(ctx.hasAnyScope([])).toBe(false);
    });

    it('should return false when session has no scopes', () => {
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } });
      expect(ctx.hasAnyScope(['openid'])).toBe(false);
    });
  });

  // =========================================================================
  // Claims mapping — IdP-specific JWT shapes
  // =========================================================================

  describe('with claimsMapping', () => {
    it('should extract roles via Keycloak realm_access.roles', () => {
      const mapping: AuthoritiesClaimsMapping = { roles: 'realm_access.roles' };
      const ctx = new FrontMcpAuthContextImpl(
        { user: { sub: 'u1', realm_access: { roles: ['admin', 'user'] } } },
        mapping,
      );
      expect(ctx.roles).toEqual(['admin', 'user']);
    });

    it('should extract permissions via Keycloak resource_access path', () => {
      const mapping: AuthoritiesClaimsMapping = {
        permissions: 'resource_access.account.roles',
      };
      const ctx = new FrontMcpAuthContextImpl(
        { user: { sub: 'u1', resource_access: { account: { roles: ['manage-account'] } } } },
        mapping,
      );
      expect(ctx.permissions).toEqual(['manage-account']);
    });

    it('should extract roles via Auth0 namespaced claims', () => {
      const mapping: AuthoritiesClaimsMapping = { roles: 'https://myapp.com/roles' };
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1', 'https://myapp.com/roles': ['admin'] } }, mapping);
      expect(ctx.roles).toEqual(['admin']);
    });

    it('should extract permissions from Auth0 permissions claim', () => {
      const mapping: AuthoritiesClaimsMapping = { permissions: 'permissions' };
      const ctx = new FrontMcpAuthContextImpl(
        { user: { sub: 'u1', permissions: ['read:users', 'write:users'] } },
        mapping,
      );
      expect(ctx.permissions).toEqual(['read:users', 'write:users']);
    });

    it('should extract roles via Okta groups', () => {
      const mapping: AuthoritiesClaimsMapping = { roles: 'groups', permissions: 'scp' };
      const ctx = new FrontMcpAuthContextImpl(
        { user: { sub: 'u1', groups: ['Everyone', 'Admins'], scp: ['openid', 'profile'] } },
        mapping,
      );
      expect(ctx.roles).toEqual(['Everyone', 'Admins']);
      expect(ctx.permissions).toEqual(['openid', 'profile']);
    });

    it('should extract roles via Cognito groups', () => {
      const mapping: AuthoritiesClaimsMapping = { roles: 'cognito:groups' };
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1', 'cognito:groups': ['Admins', 'Users'] } }, mapping);
      expect(ctx.roles).toEqual(['Admins', 'Users']);
    });

    it('should extract roles from Frontegg claims', () => {
      const mapping: AuthoritiesClaimsMapping = {
        roles: 'roles',
        permissions: 'permissions',
        tenantId: 'tenantId',
      };
      const ctx = new FrontMcpAuthContextImpl(
        { user: { sub: 'u1', roles: ['Admin'], permissions: ['fe.read'], tenantId: 'tenant-1' } },
        mapping,
      );
      expect(ctx.roles).toEqual(['Admin']);
      expect(ctx.permissions).toEqual(['fe.read']);
      expect(ctx.claims['tenantId']).toBe('tenant-1');
    });

    it('should resolve userId from custom path', () => {
      const mapping: AuthoritiesClaimsMapping = { userId: 'custom_uid' };
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'fallback-sub', custom_uid: 'uid-42' } }, mapping);
      expect(ctx.user.sub).toBe('uid-42');
    });

    it('should fall back to user.sub when userId path resolves to undefined', () => {
      const mapping: AuthoritiesClaimsMapping = { userId: 'nonexistent.path' };
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'fallback-sub' } }, mapping);
      expect(ctx.user.sub).toBe('fallback-sub');
    });

    it('should return empty arrays when mapped path resolves to nothing', () => {
      const mapping: AuthoritiesClaimsMapping = { roles: 'nonexistent.path' };
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1' } }, mapping);
      expect(ctx.roles).toEqual([]);
    });

    it('should handle space-separated string scopes (Okta scp format)', () => {
      const mapping: AuthoritiesClaimsMapping = { permissions: 'scope' };
      const ctx = new FrontMcpAuthContextImpl({ user: { sub: 'u1', scope: 'read write delete' } }, mapping);
      expect(ctx.permissions).toEqual(['read', 'write', 'delete']);
    });

    it('should handle claims from extra.authorization.claims with mapping', () => {
      const mapping: AuthoritiesClaimsMapping = { roles: 'org_roles' };
      const ctx = new FrontMcpAuthContextImpl(
        {
          user: { sub: 'u1' },
          extra: { authorization: { claims: { org_roles: ['manager', 'viewer'] } } },
        },
        mapping,
      );
      // authorization.claims are merged, then user overrides — org_roles from claims
      expect(ctx.roles).toEqual(['manager', 'viewer']);
    });
  });

  // =========================================================================
  // Roles from extra.authorization.scopes fallback
  // =========================================================================

  describe('roles fallback to extra.authorization.scopes', () => {
    it('should use extra.authorization.scopes as roles when no user.roles', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1' },
        extra: { authorization: { scopes: ['admin', 'editor'] } },
      });
      expect(ctx.roles).toEqual(['admin', 'editor']);
    });

    it('should prefer user.roles over extra.authorization.scopes', () => {
      const ctx = new FrontMcpAuthContextImpl({
        user: { sub: 'u1', roles: ['from-user'] },
        extra: { authorization: { scopes: ['from-auth'] } },
      });
      expect(ctx.roles).toEqual(['from-user']);
    });
  });

  // =========================================================================
  // Interface compliance
  // =========================================================================

  describe('FrontMcpAuthContext interface compliance', () => {
    it('should satisfy the FrontMcpAuthContext interface', () => {
      const ctx: FrontMcpAuthContext = new FrontMcpAuthContextImpl(authenticatedSource());

      // All interface fields must be accessible
      expect(ctx.user).toBeDefined();
      expect(typeof ctx.isAnonymous).toBe('boolean');
      expect(typeof ctx.mode).toBe('string');
      expect(typeof ctx.sessionId).toBe('string');
      expect(Array.isArray(ctx.scopes)).toBe(true);
      expect(typeof ctx.claims).toBe('object');
      expect(Array.isArray(ctx.roles)).toBe(true);
      expect(Array.isArray(ctx.permissions)).toBe(true);

      // All interface methods must be callable
      expect(typeof ctx.hasRole).toBe('function');
      expect(typeof ctx.hasPermission).toBe('function');
      expect(typeof ctx.hasScope).toBe('function');
      expect(typeof ctx.hasAllScopes).toBe('function');
    });
  });
});

// ===========================================================================
// buildAuthContext factory
// ===========================================================================

describe('buildAuthContext', () => {
  it('should return a FrontMcpAuthContext', () => {
    const ctx = buildAuthContext({ user: { sub: 'u1' } });

    expect(ctx.user.sub).toBe('u1');
    expect(ctx.isAnonymous).toBe(false);
    expect(typeof ctx.hasRole).toBe('function');
  });

  it('should accept claimsMapping as second argument', () => {
    const ctx = buildAuthContext(
      { user: { sub: 'u1', realm_access: { roles: ['admin'] } } },
      { roles: 'realm_access.roles' },
    );
    expect(ctx.roles).toEqual(['admin']);
  });

  it('should work with an empty source', () => {
    const ctx = buildAuthContext({});

    expect(ctx.isAnonymous).toBe(true);
    expect(ctx.user.sub).toBe('');
    expect(ctx.roles).toEqual([]);
    expect(ctx.permissions).toEqual([]);
    expect(ctx.scopes).toEqual([]);
  });

  it('should produce an immutable context', () => {
    const ctx = buildAuthContext({
      user: { sub: 'u1', roles: ['admin'] },
      scopes: ['openid'],
    });

    expect(Object.isFrozen(ctx.user)).toBe(true);
    expect(Object.isFrozen(ctx.scopes)).toBe(true);
    expect(Object.isFrozen(ctx.roles)).toBe(true);
    expect(Object.isFrozen(ctx.permissions)).toBe(true);
    expect(Object.isFrozen(ctx.claims)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Auth Context Pipes
// ---------------------------------------------------------------------------

describe('Auth Context Pipes', () => {
  it('should run sync pipe and merge custom fields', async () => {
    const ctx = await buildAuthContext(
      { user: { sub: 'user-1' }, extra: { authorization: { claims: { tenantId: 'tenant-42' } } } },
      undefined,
      [(claims) => ({ tenantId: claims['tenantId'] as string })],
    );
    expect((ctx as unknown as Record<string, unknown>)['tenantId']).toBe('tenant-42');
  });

  it('should run async pipe', async () => {
    const ctx = await buildAuthContext({ user: { sub: 'user-1' } }, undefined, [
      async () => ({ asyncField: 'resolved' }),
    ]);
    expect((ctx as unknown as Record<string, unknown>)['asyncField']).toBe('resolved');
  });

  it('should merge multiple pipes in order', async () => {
    const ctx = await buildAuthContext({ user: { sub: 'user-1' } }, undefined, [
      () => ({ fieldA: 'from-pipe-1', shared: 'first' }),
      () => ({ fieldB: 'from-pipe-2', shared: 'second' }),
    ]);
    const record = ctx as unknown as Record<string, unknown>;
    expect(record['fieldA']).toBe('from-pipe-1');
    expect(record['fieldB']).toBe('from-pipe-2');
    expect(record['shared']).toBe('second'); // last pipe wins
  });

  it('should not crash when a pipe throws', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = await buildAuthContext({ user: { sub: 'user-1' } }, undefined, [
      () => {
        throw new Error('pipe failed');
      },
      () => ({ survived: true }),
    ]);
    expect((ctx as unknown as Record<string, unknown>)['survived']).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pipe failed'));
    consoleSpy.mockRestore();
  });

  it('should preserve base context fields alongside pipe extensions', async () => {
    const ctx = await buildAuthContext({ user: { sub: 'admin-user' } }, { roles: 'roles' }, [
      () => ({ customField: 'hello' }),
    ]);
    expect(ctx.user.sub).toBe('admin-user');
    expect(ctx.hasRole).toBeDefined();
    expect((ctx as unknown as Record<string, unknown>)['customField']).toBe('hello');
  });

  it('should return sync context when no pipes provided', () => {
    // Without pipes, buildAuthContext returns synchronously
    const ctx = buildAuthContext({ user: { sub: 'user-1' } });
    expect(ctx.user.sub).toBe('user-1');
    // Not a promise
    expect(ctx).not.toBeInstanceOf(Promise);
  });
});
