import 'reflect-metadata';
import ApprovalCheckPlugin from '../approval-check.hook';
import { ApprovalStoreToken } from '../../approval.symbols';
import { ApprovalRequiredError } from '../../approval';
import { ApprovalScope, ApprovalState } from '../../types';
import type { ApprovalStore } from '../../stores';

// Mock the SDK decorators
jest.mock('@frontmcp/sdk', () => ({
  DynamicPlugin: class {
    get<T>(token: unknown): T {
      return (this as unknown as { _injections: Map<unknown, unknown> })._injections.get(token) as T;
    }
  },
  Plugin: () => (target: unknown) => target,
  ToolHook: {
    Will: () => () => (target: unknown) => target,
  },
}));

describe('ApprovalCheckPlugin', () => {
  let plugin: ApprovalCheckPlugin;
  let mockStore: jest.Mocked<ApprovalStore>;
  let mockFlowCtx: {
    state: {
      tool?: {
        fullName: string;
        metadata: Record<string, unknown>;
      };
      toolContext?: {
        tryGetContext?: () => {
          sessionId?: string;
          authInfo?: {
            clientId?: string;
            extra?: Record<string, unknown>;
          };
        };
        input?: Record<string, unknown>;
      };
    };
  };

  beforeEach(() => {
    plugin = new ApprovalCheckPlugin();

    // Set up mock store
    mockStore = {
      getApproval: jest.fn(),
      setApproval: jest.fn(),
      revokeApproval: jest.fn(),
      listApprovals: jest.fn(),
      clearExpired: jest.fn(),
    } as unknown as jest.Mocked<ApprovalStore>;

    // Inject the mock store
    (plugin as unknown as { _injections: Map<unknown, unknown> })._injections = new Map([
      [ApprovalStoreToken, mockStore],
    ]);

    // Set up default flow context
    mockFlowCtx = {
      state: {
        tool: {
          fullName: 'test-tool',
          metadata: {},
        },
        toolContext: {
          tryGetContext: () => ({
            sessionId: 'session-123',
            authInfo: {
              clientId: 'client-456',
              extra: {},
            },
          }),
        },
      },
    };
  });

  describe('checkApproval', () => {
    it('should skip if no tool or toolContext', async () => {
      mockFlowCtx.state.tool = undefined;
      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).not.toHaveBeenCalled();
    });

    it('should skip if toolContext is undefined', async () => {
      mockFlowCtx.state.toolContext = undefined;
      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).not.toHaveBeenCalled();
    });

    it('should skip if approval is not required', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = false;
      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).not.toHaveBeenCalled();
    });

    it('should skip if approval is undefined', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = undefined;
      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).not.toHaveBeenCalled();
    });

    it('should skip if skipApproval is true', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        skipApproval: true,
      };
      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).not.toHaveBeenCalled();
    });

    it('should allow when approval is true and tool is approved', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockStore.getApproval.mockResolvedValue({
        toolId: 'test-tool',
        state: ApprovalState.APPROVED,
        scope: ApprovalScope.SESSION,
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      });

      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).toHaveBeenCalled();
    });

    it('should throw ApprovalRequiredError when tool is denied', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockStore.getApproval.mockResolvedValue({
        toolId: 'test-tool',
        state: ApprovalState.DENIED,
        scope: ApprovalScope.SESSION,
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      });

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should throw ApprovalRequiredError when no approval exists', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockStore.getApproval.mockResolvedValue(undefined);

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should throw when approval is expired', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockStore.getApproval.mockResolvedValue({
        toolId: 'test-tool',
        state: ApprovalState.APPROVED,
        scope: ApprovalScope.SESSION,
        grantedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000, // Expired
        grantedBy: { source: 'user' },
      });

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should throw with state "expired" when approval is expired', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockStore.getApproval.mockResolvedValue({
        toolId: 'test-tool',
        state: ApprovalState.APPROVED,
        scope: ApprovalScope.SESSION,
        grantedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
        grantedBy: { source: 'user' },
      });

      try {
        await plugin.checkApproval(mockFlowCtx as never);
        fail('Expected ApprovalRequiredError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalRequiredError);
        expect((error as ApprovalRequiredError).details.state).toBe('expired');
      }
    });

    it('should use userId from extra.userId if available', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext!.tryGetContext = () => ({
        sessionId: 'session-123',
        authInfo: {
          clientId: 'client-456',
          extra: { userId: 'user-789' },
        },
      });
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
      } catch {
        // Expected to throw
      }

      expect(mockStore.getApproval).toHaveBeenCalledWith('test-tool', 'session-123', 'user-789');
    });

    it('should use userId from extra.sub if userId not available', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext!.tryGetContext = () => ({
        sessionId: 'session-123',
        authInfo: {
          clientId: 'client-456',
          extra: { sub: 'sub-user' },
        },
      });
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
      } catch {
        // Expected to throw
      }

      expect(mockStore.getApproval).toHaveBeenCalledWith('test-tool', 'session-123', 'sub-user');
    });

    it('should use clientId as fallback for userId', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext!.tryGetContext = () => ({
        sessionId: 'session-123',
        authInfo: {
          clientId: 'client-456',
          extra: {},
        },
      });
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
      } catch {
        // Expected to throw
      }

      expect(mockStore.getApproval).toHaveBeenCalledWith('test-tool', 'session-123', 'client-456');
    });

    it('should handle alwaysPrompt option', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        alwaysPrompt: true,
      };
      mockStore.getApproval.mockResolvedValue({
        toolId: 'test-tool',
        state: ApprovalState.APPROVED,
        scope: ApprovalScope.SESSION,
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
      });

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should skip for pre-approved context', async () => {
      const approvalContext = { type: 'project', identifier: 'trusted-project' };
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        preApprovedContexts: [approvalContext],
      };
      mockFlowCtx.state.toolContext!.input = {
        context: approvalContext,
      };

      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).not.toHaveBeenCalled();
    });

    it('should get context from session authInfo extra', async () => {
      const approvalContext = { type: 'project', identifier: 'trusted-project' };
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        preApprovedContexts: [approvalContext],
      };
      mockFlowCtx.state.toolContext!.tryGetContext = () => ({
        sessionId: 'session-123',
        authInfo: {
          clientId: 'client-456',
          extra: { approvalContext },
        },
      });

      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).not.toHaveBeenCalled();
    });

    it('should include approval options in error', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        allowedScopes: [ApprovalScope.SESSION, ApprovalScope.USER],
        defaultScope: ApprovalScope.SESSION,
        maxTtlMs: 3600000,
        category: 'write',
        riskLevel: 'high',
        approvalMessage: 'Custom message',
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
        fail('Expected ApprovalRequiredError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalRequiredError);
        const approvalError = error as ApprovalRequiredError;
        expect(approvalError.message).toBe('Custom message');
        expect(approvalError.details.approvalOptions?.allowedScopes).toEqual([
          ApprovalScope.SESSION,
          ApprovalScope.USER,
        ]);
        expect(approvalError.details.approvalOptions?.defaultScope).toBe(ApprovalScope.SESSION);
        expect(approvalError.details.approvalOptions?.maxTtlMs).toBe(3600000);
        expect(approvalError.details.approvalOptions?.category).toBe('write');
        expect(approvalError.details.approvalOptions?.riskLevel).toBe('high');
      }
    });

    it('should handle missing tryGetContext', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext = {
        tryGetContext: undefined,
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
      } catch {
        // Expected to throw
      }

      expect(mockStore.getApproval).toHaveBeenCalledWith('test-tool', 'unknown', undefined);
    });

    it('should not match pre-approved context with different type', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        preApprovedContexts: [{ type: 'project', identifier: 'trusted-project' }],
      };
      mockFlowCtx.state.toolContext!.input = {
        context: { type: 'different', identifier: 'trusted-project' },
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should not match pre-approved context with different identifier', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        preApprovedContexts: [{ type: 'project', identifier: 'trusted-project' }],
      };
      mockFlowCtx.state.toolContext!.input = {
        context: { type: 'project', identifier: 'different-project' },
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should handle non-approval-context input', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext!.input = {
        context: 'not-an-object',
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should handle context missing required fields', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext!.input = {
        context: { type: 'project' }, // Missing identifier
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should handle non-string type in context', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext!.input = {
        context: { type: 123, identifier: 'test' },
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should handle approval config with boolean true', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalRequiredError);
        const approvalError = error as ApprovalRequiredError;
        expect(approvalError.details.approvalOptions?.defaultScope).toBe(ApprovalScope.SESSION);
      }
    });

    it('should use default scope when not specified in config', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        // No defaultScope specified
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalRequiredError);
        const approvalError = error as ApprovalRequiredError;
        expect(approvalError.details.approvalOptions?.defaultScope).toBe(ApprovalScope.SESSION);
      }
    });

    it('should default required to true when not specified in config object', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        // required not specified
        defaultScope: ApprovalScope.USER,
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should handle approval with no expiresAt (non-expiring)', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockStore.getApproval.mockResolvedValue({
        toolId: 'test-tool',
        state: ApprovalState.APPROVED,
        scope: ApprovalScope.SESSION,
        grantedAt: Date.now() - 10000,
        // No expiresAt - should not expire
        grantedBy: { source: 'user' },
      });

      await plugin.checkApproval(mockFlowCtx as never);
      // Should not throw
    });

    it('should handle undefined authInfo.extra', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext!.tryGetContext = () => ({
        sessionId: 'session-123',
        authInfo: {
          clientId: 'client-456',
          extra: undefined,
        },
      });
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
      } catch {
        // Expected to throw
      }

      expect(mockStore.getApproval).toHaveBeenCalledWith('test-tool', 'session-123', 'client-456');
    });

    it('should prefer input context over session context', async () => {
      const inputContext = { type: 'project', identifier: 'input-project' };
      const sessionContext = { type: 'project', identifier: 'session-project' };
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        preApprovedContexts: [inputContext],
      };
      mockFlowCtx.state.toolContext!.input = { context: inputContext };
      mockFlowCtx.state.toolContext!.tryGetContext = () => ({
        sessionId: 'session-123',
        authInfo: {
          clientId: 'client-456',
          extra: { approvalContext: sessionContext },
        },
      });

      // Should match the input context, not session
      await plugin.checkApproval(mockFlowCtx as never);
      expect(mockStore.getApproval).not.toHaveBeenCalled();
    });

    it('should handle empty preApprovedContexts array', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        preApprovedContexts: [],
      };
      mockFlowCtx.state.toolContext!.input = {
        context: { type: 'project', identifier: 'test' },
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      await expect(plugin.checkApproval(mockFlowCtx as never)).rejects.toThrow(ApprovalRequiredError);
    });

    it('should handle non-string extra values', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = true;
      mockFlowCtx.state.toolContext!.tryGetContext = () => ({
        sessionId: 'session-123',
        authInfo: {
          clientId: 'client-456',
          extra: { userId: 123 }, // Non-string
        },
      });
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
      } catch {
        // Expected to throw
      }

      // Should fall through to clientId since userId is not a string
      expect(mockStore.getApproval).toHaveBeenCalledWith('test-tool', 'session-123', 'client-456');
    });

    it('should generate default approval message', async () => {
      mockFlowCtx.state.tool!.metadata['approval'] = {
        required: true,
        // No approvalMessage
      };
      mockStore.getApproval.mockResolvedValue(undefined);

      try {
        await plugin.checkApproval(mockFlowCtx as never);
        fail('Expected ApprovalRequiredError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalRequiredError);
        expect((error as ApprovalRequiredError).message).toBe('Tool "test-tool" requires approval to execute. Allow?');
      }
    });
  });
});
