// file: libs/sdk/src/skill/__tests__/tool-authorization.spec.ts

import { ToolAuthorizationGuard } from '../guards/tool-authorization.guard';
import { SkillSessionManager, MemorySkillSessionStore } from '../session';
import { ToolNotAllowedError, ToolApprovalRequiredError } from '../errors/tool-not-allowed.error';
import type { SkillContent } from '../../common/interfaces';
import type { SkillLoadResult } from '../skill-storage.interface';

describe('ToolAuthorizationGuard', () => {
  let manager: SkillSessionManager;
  let guard: ToolAuthorizationGuard;
  let store: MemorySkillSessionStore;

  const mockSkillContent: SkillContent = {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill',
    instructions: 'Do something',
    tools: [
      { name: 'allowed_tool', purpose: 'Allowed' },
      { name: 'another_allowed', purpose: 'Also allowed' },
    ],
  };

  const mockLoadResult: SkillLoadResult = {
    skill: mockSkillContent,
    availableTools: ['allowed_tool', 'another_allowed'],
    missingTools: [],
    isComplete: true,
  };

  beforeEach(() => {
    store = new MemorySkillSessionStore();
    manager = new SkillSessionManager({ defaultPolicyMode: 'strict' }, undefined, store);
    guard = new ToolAuthorizationGuard(manager);
  });

  describe('check', () => {
    it('should allow tools in the skill allowlist', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const result = await guard.check('allowed_tool');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('skill_allowlist');
      });
    });

    it('should throw ToolNotAllowedError for unauthorized tools', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        await expect(guard.check('unauthorized_tool')).rejects.toThrow(ToolNotAllowedError);
      });
    });

    it('should not throw when throwOnDenied is false', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const result = await guard.check('unauthorized_tool', { throwOnDenied: false });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('not_in_allowlist');
      });
    });

    it('should record tool calls for rate limiting', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        await guard.check('allowed_tool');
        await guard.check('allowed_tool');

        const session = manager.getActiveSession();
        expect(session?.toolCallCount).toBe(2);
      });
    });

    it('should allow all tools when no skill is active', async () => {
      await manager.runWithSession('session-1', async () => {
        const result = await guard.check('any_tool');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('no_active_skill');
      });
    });
  });

  describe('approval flow', () => {
    beforeEach(() => {
      manager = new SkillSessionManager({ defaultPolicyMode: 'approval' }, undefined, store);
      guard = new ToolAuthorizationGuard(manager);
    });

    it('should call onApprovalRequired callback', async () => {
      const onApprovalRequired = jest.fn().mockResolvedValue(true);

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const result = await guard.check('new_tool', { onApprovalRequired });

        expect(onApprovalRequired).toHaveBeenCalledWith('new_tool', 'test-skill');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('dynamically_approved');
      });
    });

    it('should deny when approval callback returns false', async () => {
      const onApprovalRequired = jest.fn().mockResolvedValue(false);

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        await expect(guard.check('new_tool', { onApprovalRequired })).rejects.toThrow(ToolApprovalRequiredError);
      });
    });

    it('should add approved tool to session', async () => {
      const onApprovalRequired = jest.fn().mockResolvedValue(true);

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        await guard.check('new_tool', { onApprovalRequired });

        // Second check should not need approval
        const result = await guard.check('new_tool');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('dynamically_approved');
      });
    });
  });

  describe('isAllowed', () => {
    it('should return true for allowed tools', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const allowed = await guard.isAllowed('allowed_tool');
        expect(allowed).toBe(true);
      });
    });

    it('should return false for denied tools without throwing', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const allowed = await guard.isAllowed('unauthorized_tool');
        expect(allowed).toBe(false);
      });
    });
  });

  describe('getAllowlist', () => {
    it('should return the tool allowlist', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const allowlist = guard.getAllowlist();
        expect(allowlist).toContain('allowed_tool');
        expect(allowlist).toContain('another_allowed');
      });
    });
  });

  describe('approveTool / denyTool', () => {
    it('should manually approve a tool', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        guard.approveTool('new_tool');

        const result = await guard.check('new_tool');
        expect(result.allowed).toBe(true);
      });
    });

    it('should manually deny a tool', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        guard.denyTool('allowed_tool');

        const result = await guard.check('allowed_tool', { throwOnDenied: false });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('denied');
      });
    });
  });

  describe('hasActiveSkill', () => {
    it('should return true when skill is active', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
        expect(guard.hasActiveSkill()).toBe(true);
      });
    });

    it('should return false when no skill is active', async () => {
      await manager.runWithSession('session-1', async () => {
        expect(guard.hasActiveSkill()).toBe(false);
      });
    });
  });
});

describe('ToolNotAllowedError', () => {
  it('should format error message for not_in_allowlist with skill name', () => {
    const error = new ToolNotAllowedError(
      {
        allowed: false,
        reason: 'not_in_allowlist',
        toolName: 'unauthorized_tool',
        skillId: 'test-skill',
        skillName: 'Test Skill',
      },
      ['tool_a', 'tool_b'],
    );

    expect(error.message).toContain('unauthorized_tool');
    expect(error.message).toContain('Test Skill');
    expect(error.message).toContain('tool_a, tool_b');
    expect(error.message).toContain('not permitted');
    expect(error.message).toContain('Please use one of the allowed tools');
    expect(error.toolName).toBe('unauthorized_tool');
    expect(error.skillId).toBe('test-skill');
    expect(error.skillName).toBe('Test Skill');
    expect(error.allowedTools).toEqual(['tool_a', 'tool_b']);
  });

  it('should format error message for not_in_allowlist with skill ID only', () => {
    const error = new ToolNotAllowedError(
      {
        allowed: false,
        reason: 'not_in_allowlist',
        toolName: 'unauthorized_tool',
        skillId: 'test-skill',
      },
      ['tool_a', 'tool_b'],
    );

    expect(error.message).toContain('unauthorized_tool');
    expect(error.message).toContain('test-skill');
    expect(error.message).toContain('tool_a, tool_b');
  });

  it('should format error message for denied', () => {
    const error = new ToolNotAllowedError({
      allowed: false,
      reason: 'denied',
      toolName: 'denied_tool',
      skillId: 'test-skill',
      skillName: 'Test Skill',
    });

    expect(error.message).toContain('explicitly denied');
    expect(error.message).toContain('Test Skill');
    expect(error.reason).toBe('denied');
  });

  it('should format error message for rate_limited', () => {
    const error = new ToolNotAllowedError({
      allowed: false,
      reason: 'rate_limited',
      toolName: 'some_tool',
      skillId: 'test-skill',
      skillName: 'Test Skill',
    });

    expect(error.message).toContain('rate limit');
    expect(error.message).toContain('Test Skill');
    expect(error.reason).toBe('rate_limited');
  });

  it('should format error message for no_active_skill', () => {
    const error = new ToolNotAllowedError({
      allowed: false,
      reason: 'no_active_skill',
      toolName: 'some_tool',
    });

    expect(error.message).toContain('no skill is active');
    expect(error.message).toContain('loadSkill');
    expect(error.reason).toBe('no_active_skill');
  });

  it('should produce JSON-RPC error with skill name', () => {
    const error = new ToolNotAllowedError(
      {
        allowed: false,
        reason: 'not_in_allowlist',
        toolName: 'test_tool',
        skillId: 'test-skill',
        skillName: 'Test Skill',
      },
      ['allowed'],
    );

    const jsonRpc = error.toJsonRpcError();
    expect(jsonRpc.code).toBe(-32600); // INVALID_REQUEST
    expect(jsonRpc.data.toolName).toBe('test_tool');
    expect(jsonRpc.data.skillId).toBe('test-skill');
    expect(jsonRpc.data.skillName).toBe('Test Skill');
    expect(jsonRpc.data.allowedTools).toEqual(['allowed']);
  });
});

describe('ToolApprovalRequiredError', () => {
  it('should format error message with skill ID', () => {
    const error = new ToolApprovalRequiredError('new_tool', 'test-skill');

    expect(error.message).toContain('requires approval');
    expect(error.message).toContain('new_tool');
    expect(error.message).toContain('test-skill');
    expect(error.toolName).toBe('new_tool');
    expect(error.skillId).toBe('test-skill');
  });

  it('should format error message without skill ID', () => {
    const error = new ToolApprovalRequiredError('new_tool');

    expect(error.message).toContain('requires approval');
    expect(error.skillId).toBeUndefined();
  });

  it('should produce JSON-RPC error with requiresApproval flag', () => {
    const error = new ToolApprovalRequiredError('new_tool', 'test-skill');

    const jsonRpc = error.toJsonRpcError();
    expect(jsonRpc.data.requiresApproval).toBe(true);
    expect(jsonRpc.data.toolName).toBe('new_tool');
  });
});
