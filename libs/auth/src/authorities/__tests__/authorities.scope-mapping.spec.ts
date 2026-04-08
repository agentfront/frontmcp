import { resolveRequiredScopes } from '../authorities.scope-mapping';
import type { AuthoritiesDenial } from '../authorities.types';
import type { AuthoritiesScopeMapping } from '../authorities.profiles';

describe('resolveRequiredScopes', () => {
  const mapping: AuthoritiesScopeMapping = {
    roles: {
      admin: ['admin:all'],
      deployer: ['deploy:execute', 'deploy:read'],
    },
    permissions: {
      'repo:write': ['repo'],
      'repo:read': ['repo:read'],
    },
    profiles: {
      admin: ['admin:all'],
      editor: ['content:write'],
    },
  };

  it('should resolve scopes from role denial', () => {
    const denial: AuthoritiesDenial = { kind: 'roles', path: 'roles.all', missing: ['admin'] };
    const scopes = resolveRequiredScopes(denial, mapping, { roles: { all: ['admin'] } });
    expect(scopes).toEqual(['admin:all']);
  });

  it('should resolve scopes from permission denial', () => {
    const denial: AuthoritiesDenial = { kind: 'permissions', path: 'permissions.all', missing: ['repo:write'] };
    const scopes = resolveRequiredScopes(denial, mapping, { permissions: { all: ['repo:write'] } });
    expect(scopes).toEqual(['repo']);
  });

  it('should resolve scopes from string profile', () => {
    const denial: AuthoritiesDenial = { kind: 'profile', path: 'profile:admin' };
    const scopes = resolveRequiredScopes(denial, mapping, 'admin');
    expect(scopes).toEqual(['admin:all']);
  });

  it('should resolve scopes from profile array', () => {
    const denial: AuthoritiesDenial = { kind: 'profile', path: 'profile:admin' };
    const scopes = resolveRequiredScopes(denial, mapping, ['admin', 'editor']);
    expect(scopes).toEqual(['admin:all', 'content:write']);
  });

  it('should return undefined when no mapping matches', () => {
    const denial: AuthoritiesDenial = { kind: 'attributes', path: 'attributes.match' };
    const scopes = resolveRequiredScopes(denial, mapping, { attributes: { match: {} } });
    expect(scopes).toBeUndefined();
  });

  it('should return undefined when denial has no missing roles', () => {
    const denial: AuthoritiesDenial = { kind: 'roles', path: 'roles.any', missing: ['viewer'] };
    const scopes = resolveRequiredScopes(denial, mapping, { roles: { any: ['viewer'] } });
    expect(scopes).toBeUndefined(); // 'viewer' not in mapping
  });

  it('should combine scopes from multiple missing roles', () => {
    const denial: AuthoritiesDenial = { kind: 'roles', path: 'roles.all', missing: ['admin', 'deployer'] };
    const scopes = resolveRequiredScopes(denial, mapping, { roles: { all: ['admin', 'deployer'] } });
    expect(scopes).toEqual(['admin:all', 'deploy:execute', 'deploy:read']);
  });

  it('should deduplicate scopes', () => {
    const dupMapping: AuthoritiesScopeMapping = {
      roles: { a: ['scope1', 'scope2'], b: ['scope2', 'scope3'] },
    };
    const denial: AuthoritiesDenial = { kind: 'roles', path: 'roles.all', missing: ['a', 'b'] };
    const scopes = resolveRequiredScopes(denial, dupMapping, { roles: { all: ['a', 'b'] } });
    expect(scopes).toEqual(['scope1', 'scope2', 'scope3']); // sorted, no dups
  });

  it('should return undefined for empty mapping', () => {
    const denial: AuthoritiesDenial = { kind: 'roles', path: 'roles.all', missing: ['admin'] };
    const scopes = resolveRequiredScopes(denial, {}, { roles: { all: ['admin'] } });
    expect(scopes).toBeUndefined();
  });
});
