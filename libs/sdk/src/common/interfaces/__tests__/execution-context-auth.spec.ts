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

describe('ExecutionContextBase.loadAuthContext with authorities pipes (#678)', () => {
  function contextWith(authorities: Record<string, unknown> | undefined, authInfo: Record<string, unknown>) {
    const warn = jest.fn();
    const providers = {
      get: () => {
        throw new Error('not found');
      },
      getScope: () => ({ metadata: { authorities } }),
    };
    const ctx = new TestContext({ providers: providers as never, logger: { warn } as never, authInfo });
    return { ctx, warn };
  }

  it('applies sync and async pipes to this.auth', async () => {
    const { ctx, warn } = contextWith(
      {
        pipes: [
          () => ({ team: 'billing' }),
          async (claims: Record<string, unknown>) => ({ tenant: `t-${String(claims['sub'])}` }),
        ],
      },
      { user: { sub: 'alice' } },
    );

    await ctx.loadAuthContext();

    const auth = ctx.auth as unknown as { team?: string; tenant?: string };
    expect(auth.team).toBe('billing');
    expect(auth.tenant).toBe('t-alice');
    expect(warn).not.toHaveBeenCalled();
  });

  it('does nothing without pipes', async () => {
    const { ctx, warn } = contextWith(undefined, { user: { sub: 'alice' } });

    await ctx.loadAuthContext();

    expect(ctx.auth.user.sub).toBe('alice');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when this.auth is read before the pipes ran', () => {
    const { ctx, warn } = contextWith({ pipes: [() => ({ team: 'billing' })] }, { user: { sub: 'alice' } });

    expect((ctx.auth as unknown as { team?: string }).team).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('before the `authorities.pipes` ran'));
  });
});
