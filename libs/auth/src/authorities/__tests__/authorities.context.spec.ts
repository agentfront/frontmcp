import { AuthoritiesContextBuilder, resolveDotPath } from '../authorities.context';

describe('resolveDotPath', () => {
  it('should resolve a simple key', () => {
    expect(resolveDotPath({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  it('should resolve a nested path', () => {
    expect(resolveDotPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('should return undefined for missing path', () => {
    expect(resolveDotPath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('should return undefined for null intermediate', () => {
    expect(resolveDotPath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('should handle array values', () => {
    expect(resolveDotPath({ roles: ['admin', 'user'] }, 'roles')).toEqual(['admin', 'user']);
  });
});

describe('AuthoritiesContextBuilder', () => {
  describe('default (no claimsMapping)', () => {
    it('should extract roles from user.roles', () => {
      const builder = new AuthoritiesContextBuilder();
      const ctx = builder.build({ user: { sub: 'u1', roles: ['admin', 'user'] } });
      expect(ctx.user.roles).toEqual(['admin', 'user']);
      expect(ctx.user.sub).toBe('u1');
    });

    it('should extract permissions from user.permissions', () => {
      const builder = new AuthoritiesContextBuilder();
      const ctx = builder.build({ user: { sub: 'u1', permissions: ['read', 'write'] } });
      expect(ctx.user.permissions).toEqual(['read', 'write']);
    });

    it('should handle missing user gracefully', () => {
      const builder = new AuthoritiesContextBuilder();
      const ctx = builder.build({});
      expect(ctx.user.sub).toBe('');
      expect(ctx.user.roles).toEqual([]);
      expect(ctx.user.permissions).toEqual([]);
    });

    it('should pass input and env through', () => {
      const builder = new AuthoritiesContextBuilder();
      const ctx = builder.build({}, { siteId: 'site-1' }, { NODE_ENV: 'test' });
      expect(ctx.input).toEqual({ siteId: 'site-1' });
      expect(ctx.env).toEqual({ NODE_ENV: 'test' });
    });
  });

  describe('with claimsMapping', () => {
    it('should extract roles via dot-path (Keycloak style)', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { roles: 'realm_access.roles' },
      });
      const ctx = builder.build({
        user: { sub: 'u1', realm_access: { roles: ['admin', 'user'] } },
      });
      expect(ctx.user.roles).toEqual(['admin', 'user']);
    });

    it('should extract permissions via dot-path', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { permissions: 'scope' },
      });
      const ctx = builder.build({ user: { sub: 'u1', scope: 'read write delete' } });
      expect(ctx.user.permissions).toEqual(['read', 'write', 'delete']);
    });

    it('should handle Auth0 namespaced claims', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { roles: 'https://myapp.com/roles' },
      });
      const ctx = builder.build({
        user: { sub: 'u1', 'https://myapp.com/roles': ['admin'] },
      });
      expect(ctx.user.roles).toEqual(['admin']);
    });

    it('should handle Cognito groups', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { roles: 'cognito:groups' },
      });
      const ctx = builder.build({
        user: { sub: 'u1', 'cognito:groups': ['Admins', 'Users'] },
      });
      expect(ctx.user.roles).toEqual(['Admins', 'Users']);
    });

    it('should handle Okta groups/scp', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { roles: 'groups', permissions: 'scp' },
      });
      const ctx = builder.build({
        user: { sub: 'u1', groups: ['Everyone', 'Admins'], scp: ['openid', 'profile'] },
      });
      expect(ctx.user.roles).toEqual(['Everyone', 'Admins']);
      expect(ctx.user.permissions).toEqual(['openid', 'profile']);
    });

    it('should handle Frontegg claims', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { roles: 'roles', permissions: 'permissions', tenantId: 'tenantId' },
      });
      const ctx = builder.build({
        user: { sub: 'u1', roles: ['Admin'], permissions: ['fe.read', 'fe.write'], tenantId: 'tenant-1' },
      });
      expect(ctx.user.roles).toEqual(['Admin']);
      expect(ctx.user.permissions).toEqual(['fe.read', 'fe.write']);
      expect(ctx.user.claims['tenantId']).toBe('tenant-1');
    });

    it('should resolve userId from custom path', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { userId: 'user_id' },
      });
      const ctx = builder.build({
        user: { sub: 'fallback', user_id: 'custom-uid' },
      });
      expect(ctx.user.sub).toBe('custom-uid');
    });

    it('should return empty arrays when mapped path is missing', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { roles: 'nonexistent.path' },
      });
      const ctx = builder.build({ user: { sub: 'u1' } });
      expect(ctx.user.roles).toEqual([]);
    });
  });

  describe('with claimsResolver', () => {
    it('should use custom claimsResolver when provided', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsResolver: (authInfo) => ({
          roles: ['custom-role'],
          permissions: ['custom-perm'],
          claims: { custom: true, ...(authInfo?.user ?? {}) },
        }),
      });
      const ctx = builder.build({ user: { sub: 'u1' } });
      expect(ctx.user.roles).toEqual(['custom-role']);
      expect(ctx.user.permissions).toEqual(['custom-perm']);
      expect(ctx.user.claims['custom']).toBe(true);
    });

    it('should prefer claimsResolver over claimsMapping', () => {
      const builder = new AuthoritiesContextBuilder({
        claimsMapping: { roles: 'realm_access.roles' },
        claimsResolver: () => ({
          roles: ['resolver-wins'],
          permissions: [],
          claims: {},
        }),
      });
      const ctx = builder.build({ user: { sub: 'u1', realm_access: { roles: ['mapping'] } } });
      expect(ctx.user.roles).toEqual(['resolver-wins']);
    });
  });

  describe('with relationshipResolver', () => {
    it('should use provided resolver', () => {
      const mockResolver: RelationshipResolver = {
        check: async () => true,
      };
      const builder = new AuthoritiesContextBuilder({ relationshipResolver: mockResolver });
      const ctx = builder.build({});
      expect(ctx.relationships).toBe(mockResolver);
    });

    it('should default to noop resolver (always returns false)', async () => {
      const builder = new AuthoritiesContextBuilder();
      const ctx = builder.build({});
      const result = await ctx.relationships.check('member', 'site', 'site-1', 'user-1', ctx);
      expect(result).toBe(false);
    });
  });

  describe('authorization from extra', () => {
    it('should merge claims from authorization.claims', () => {
      const builder = new AuthoritiesContextBuilder();
      const ctx = builder.build({
        user: { sub: 'u1' },
        extra: {
          authorization: {
            claims: { org_id: 'org-42', plan: 'enterprise' },
          },
        },
      });
      expect(ctx.user.claims['org_id']).toBe('org-42');
      expect(ctx.user.claims['plan']).toBe('enterprise');
    });
  });
});
