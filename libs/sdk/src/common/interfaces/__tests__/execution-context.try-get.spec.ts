import { ProviderNotAvailableError, ProviderScopedAccessError } from '../../../errors';
import { ExecutionContextBase } from '../../index';

class TestContext extends ExecutionContextBase {}

function contextWhoseLookupThrows(error: Error) {
  const warn = jest.fn();
  const providers = {
    get: () => {
      throw error;
    },
    getScope: () => ({ metadata: {} }),
  };
  return { ctx: new TestContext({ providers: providers as never, logger: { warn } as never, authInfo: {} }), warn };
}

describe('ExecutionContextBase.tryGet', () => {
  it('returns undefined without a warning for a provider nothing registered', () => {
    const { ctx, warn } = contextWhoseLookupThrows(
      new ProviderNotAvailableError('SkillAuditWriter', 'not found in local or parent registries'),
    );

    expect(ctx.tryGet(Symbol.for('frontmcp:SKILL_AUDIT_WRITER'))).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('still warns when a registered provider cannot be resolved', () => {
    const { ctx, warn } = contextWhoseLookupThrows(new ProviderScopedAccessError('Cart', 'SESSION'));

    expect(ctx.tryGet(Symbol.for('cart'))).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
