import { AuthorityDeniedError } from '../authorities.errors';
import type { AuthoritiesDenial } from '../authorities.types';

describe('AuthorityDeniedError', () => {
  it('should create error with default message', () => {
    const err = new AuthorityDeniedError({
      entryType: 'Tool',
      entryName: 'delete-user',
      deniedBy: "roles.all: missing 'admin'",
    });
    expect(err.message).toBe('Access denied to Tool "delete-user": roles.all: missing \'admin\'');
    expect(err.name).toBe('AuthorityDeniedError');
    expect(err.code).toBe('AUTHORITY_DENIED');
    expect(err.statusCode).toBe(403);
    expect(err.mcpErrorCode).toBe(-32003);
    expect(err.entryType).toBe('Tool');
    expect(err.entryName).toBe('delete-user');
    expect(err.deniedBy).toBe("roles.all: missing 'admin'");
    expect(err.denial).toBeUndefined();
    expect(err.requiredScopes).toBeUndefined();
  });

  it('should create error with custom message', () => {
    const err = new AuthorityDeniedError({
      entryType: 'Resource',
      entryName: 'config://secrets',
      deniedBy: 'profile:admin',
      message: 'Custom denial message',
    });
    expect(err.message).toBe('Custom denial message');
  });

  it('should be an instance of Error', () => {
    const err = new AuthorityDeniedError({
      entryType: 'Prompt',
      entryName: 'admin-report',
      deniedBy: 'roles.any',
    });
    expect(err).toBeInstanceOf(Error);
  });

  it('should store structured denial data', () => {
    const denial: AuthoritiesDenial = {
      kind: 'roles',
      path: 'roles.all',
      missing: ['admin', 'superadmin'],
    };
    const err = new AuthorityDeniedError({
      entryType: 'Tool',
      entryName: 'delete-user',
      deniedBy: "roles.all: missing 'admin', 'superadmin'",
      denial,
    });
    expect(err.denial).toEqual(denial);
  });

  it('should store requiredScopes', () => {
    const err = new AuthorityDeniedError({
      entryType: 'Tool',
      entryName: 'deploy',
      deniedBy: 'permissions.all: missing deploy:execute',
      requiredScopes: ['deploy:execute', 'deploy:read'],
    });
    expect(err.requiredScopes).toEqual(['deploy:execute', 'deploy:read']);
  });

  describe('toJsonRpcError', () => {
    it('should return correct JSON-RPC error format', () => {
      const err = new AuthorityDeniedError({
        entryType: 'Tool',
        entryName: 'deploy',
        deniedBy: 'permissions.all: missing deploy:execute',
      });
      const rpc = err.toJsonRpcError();
      expect(rpc.code).toBe(-32003);
      expect(rpc.message).toContain('deploy');
      expect(rpc.data).toEqual({
        entryType: 'Tool',
        entryName: 'deploy',
        deniedBy: 'permissions.all: missing deploy:execute',
      });
      // undefined fields are omitted from JSON-RPC data
      expect(rpc.data?.['denial']).toBeUndefined();
      expect(rpc.data?.['requiredScopes']).toBeUndefined();
    });

    it('should include denial in JSON-RPC data', () => {
      const denial: AuthoritiesDenial = {
        kind: 'permissions',
        path: 'permissions.all',
        missing: ['deploy:execute'],
      };
      const err = new AuthorityDeniedError({
        entryType: 'Tool',
        entryName: 'deploy',
        deniedBy: 'permissions.all: missing deploy:execute',
        denial,
      });
      const rpc = err.toJsonRpcError();
      expect(rpc.data?.['denial']).toEqual(denial);
    });

    it('should include requiredScopes in JSON-RPC data', () => {
      const err = new AuthorityDeniedError({
        entryType: 'Tool',
        entryName: 'deploy',
        deniedBy: 'permissions.all: missing deploy:execute',
        requiredScopes: ['deploy:execute'],
      });
      const rpc = err.toJsonRpcError();
      expect(rpc.data?.['requiredScopes']).toEqual(['deploy:execute']);
    });
  });
});
