/**
 * The approval gate takes its context from the session, never from the caller
 * (GHSA-r848-p7wf-96rc).
 *
 * `preApprovedContexts` is documented as "contexts that are pre-approved (bypass approval
 * check)" — a list of ways to skip the prompt entirely. The context matched against that
 * list was read from `toolContext.input.context`, i.e. the arguments of the very call being
 * gated, and it OUTRANKED the session context (`contextFromInput ?? contextFromSession`).
 *
 * So a caller reads the tool's own metadata, sees which context is pre-approved, passes it
 * as an ordinary argument, and the tool runs without ever prompting. The approval store is
 * not even consulted. A client asserting its own privileges is not authorization; only the
 * server-established session can say what context a call is running in.
 */
import 'reflect-metadata';

import { ApprovalRequiredError } from '../../approval';
import { ApprovalStoreToken } from '../../approval.symbols';
import type { ApprovalStore } from '../../stores';
import { ApprovalScope, ApprovalState } from '../../types';
import ApprovalCheckPlugin from '../approval-check.hook';

jest.mock('@frontmcp/sdk', () => ({
  DynamicPlugin: class {
    get<T>(token: unknown): T {
      return (this as unknown as { _injections: Map<unknown, unknown> })._injections.get(token) as T;
    }
  },
  Plugin: () => (target: unknown) => target,
  ToolHook: { Will: () => () => (target: unknown) => target },
}));

const PRE_APPROVED = { type: 'project', identifier: 'trusted-project' };

function createGate(options: { input?: Record<string, unknown>; sessionContext?: unknown } = {}) {
  const plugin = new ApprovalCheckPlugin();

  const store = {
    getApproval: jest.fn().mockResolvedValue(undefined),
    setApproval: jest.fn(),
    revokeApproval: jest.fn(),
    listApprovals: jest.fn(),
    clearExpired: jest.fn(),
  } as unknown as jest.Mocked<ApprovalStore>;

  (plugin as unknown as { _injections: Map<unknown, unknown> })._injections = new Map([[ApprovalStoreToken, store]]);

  const flowCtx = {
    state: {
      tool: {
        fullName: 'billing:refund',
        metadata: { approval: { required: true, preApprovedContexts: [PRE_APPROVED] } },
      },
      toolContext: {
        input: options.input,
        tryGetContext: () => ({
          sessionId: 'session-123',
          verifiedSessionId: 'session-123',
          authInfo: {
            clientId: 'client-456',
            extra: options.sessionContext ? { approvalContext: options.sessionContext } : {},
          },
        }),
      },
    },
  };

  return { plugin, store, flowCtx };
}

describe('ApprovalCheckPlugin — context trust (GHSA-r848-p7wf-96rc)', () => {
  it('still requires approval when the caller supplies the pre-approved context itself', async () => {
    const { plugin, flowCtx } = createGate({ input: { context: PRE_APPROVED } });

    await expect(plugin.checkApproval(flowCtx as never)).rejects.toThrow(ApprovalRequiredError);
  });

  it('does not let caller input override a session context that is not pre-approved', async () => {
    const { plugin, flowCtx } = createGate({
      input: { context: PRE_APPROVED },
      sessionContext: { type: 'project', identifier: 'untrusted-project' },
    });

    await expect(plugin.checkApproval(flowCtx as never)).rejects.toThrow(ApprovalRequiredError);
  });

  it('consults the approval store rather than bypassing it on a caller-supplied context', async () => {
    const { plugin, store, flowCtx } = createGate({ input: { context: PRE_APPROVED } });

    await expect(plugin.checkApproval(flowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    expect(store.getApproval).toHaveBeenCalledWith('billing:refund', 'session-123', 'client-456');
  });

  it('honours a pre-approved context established by the session', async () => {
    const { plugin, flowCtx } = createGate({ sessionContext: PRE_APPROVED });

    await expect(plugin.checkApproval(flowCtx as never)).resolves.toBeUndefined();
  });

  it('still consults the store for a denial before honouring a pre-approved context', async () => {
    const { plugin, store, flowCtx } = createGate({ sessionContext: PRE_APPROVED });
    store.getApproval.mockResolvedValue({
      toolId: 'billing:refund',
      state: ApprovalState.DENIED,
      scope: ApprovalScope.USER,
      grantedAt: Date.now(),
      grantedBy: { source: 'admin' },
    });

    await expect(plugin.checkApproval(flowCtx as never)).rejects.toMatchObject({ details: { state: 'denied' } });
    expect(store.getApproval).toHaveBeenCalledWith('billing:refund', 'session-123', 'client-456');
  });

  it('honours the session context even when caller input names a different one', async () => {
    const { plugin, flowCtx } = createGate({
      input: { context: { type: 'project', identifier: 'attacker-choice' } },
      sessionContext: PRE_APPROVED,
    });

    await expect(plugin.checkApproval(flowCtx as never)).resolves.toBeUndefined();
  });
});
