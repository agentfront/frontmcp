import { FRONTMCP_CONTEXT } from '../../../context';
import { ExecutionContextBase } from '../../index';

class TestContext extends ExecutionContextBase {}

function makeContext(legacyAuthInfo: Record<string, unknown>, requestAuthInfo?: Record<string, unknown>) {
  const providers = {
    get: (token: unknown) => {
      if (token === FRONTMCP_CONTEXT && requestAuthInfo) return { authInfo: requestAuthInfo };
      throw new Error('not found');
    },
    getScope: () => ({ metadata: {} }),
  };
  return new TestContext({
    providers: providers as never,
    logger: { warn: jest.fn() } as never,
    authInfo: legacyAuthInfo,
  });
}

describe('ExecutionContextBase.auth', () => {
  it('reads scopes from the request context when the constructor copy has none (#644)', () => {
    const ctx = makeContext({ token: 't' }, { token: 't', scopes: ['read', 'write'], user: { sub: 'user-1' } });

    expect(ctx.auth.scopes).toEqual(['read', 'write']);
    expect(ctx.auth.hasScope('read')).toBe(true);
    expect(ctx.auth.hasScope('admin')).toBe(false);
    expect(ctx.auth.user.sub).toBe('user-1');
  });

  it('lets the request context win over the constructor copy', () => {
    const ctx = makeContext({ scopes: ['stale'] }, { scopes: ['fresh'] });

    expect(ctx.auth.scopes).toEqual(['fresh']);
  });

  it('falls back to the constructor copy when there is no request context', () => {
    const ctx = makeContext({ scopes: ['legacy'], user: { sub: 'legacy-user' } });

    expect(ctx.auth.scopes).toEqual(['legacy']);
    expect(ctx.auth.user.sub).toBe('legacy-user');
  });
});
