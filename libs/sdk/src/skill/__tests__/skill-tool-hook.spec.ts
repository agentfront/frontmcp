/**
 * Skill Tool Guard Hook Tests
 *
 * Tests for the createSkillToolGuardHook function that enforces tool allowlists
 * during skill-based tool execution. These tests cover Issue #1: Tool authorization
 * fullName vs base name mismatch.
 *
 * The hook needs to correctly extract the base tool name from qualified names
 * (e.g., "my-app:tool-name" -> "tool-name") because allowlists are built from
 * unqualified tool names.
 */

import { createSkillToolGuardHook, SkillToolGuardHookOptions } from '../hooks/skill-tool.hook';
import { SkillSessionManager } from '../session/skill-session.manager';
import { MemorySkillSessionStore } from '../session/skill-session-store.interface';
import type { SkillContent } from '../../common/interfaces';
import type { SkillLoadResult } from '../skill-storage.interface';
import { ToolNotAllowedError, ToolApprovalRequiredError } from '../errors/tool-not-allowed.error';

describe('SkillToolGuardHook', () => {
  let sessionManager: SkillSessionManager;
  let store: MemorySkillSessionStore;

  const mockSkillContent: SkillContent = {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill',
    instructions: 'Do something',
    tools: [
      { name: 'allowed_tool', purpose: 'Purpose A' },
      { name: 'another_allowed', purpose: 'Purpose B' },
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
    sessionManager = new SkillSessionManager({ defaultPolicyMode: 'strict' }, undefined, store);
  });

  describe('tool name extraction', () => {
    it('should extract base name from qualified tool name', async () => {
      // The hook should extract "allowed_tool" from "my-app:allowed_tool"
      // because allowlists are built from unqualified names
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Create a context with qualified fullName
        const ctx = {
          state: {
            tool: { metadata: { name: 'allowed_tool' }, fullName: 'my-app:allowed_tool' },
            input: { name: 'allowed_tool' },
          },
        };

        // Assign the context to the hook
        Object.assign(hook, ctx);

        // Should not throw - tool is in allowlist
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });

    it('should handle unqualified tool names', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Context with unqualified name (no colon)
        const ctx = {
          state: {
            tool: { metadata: { name: 'allowed_tool' } },
            input: { name: 'allowed_tool' },
          },
        };

        Object.assign(hook, ctx);

        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });

    it('should prefer metadata.name over fullName', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Context where metadata.name is the correct name, fullName has different qualified name
        const ctx = {
          state: {
            tool: { metadata: { name: 'allowed_tool' }, fullName: 'different-app:some_other_tool' },
            input: { name: 'wrong_name' },
          },
        };

        Object.assign(hook, ctx);

        // Should use metadata.name which is 'allowed_tool'
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });

    it('should fall back to input.name when metadata.name missing', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Context without metadata.name
        const ctx = {
          state: {
            tool: { metadata: {}, fullName: 'my-app:wrong_tool' },
            input: { name: 'allowed_tool' },
          },
        };

        Object.assign(hook, ctx);

        // Should fall back to input.name which is 'allowed_tool'
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });

    it('should handle multiple colons in fullName', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Context where fullName has multiple colons (nested scopes)
        // Should extract "allowed_tool" from "scope:app:allowed_tool"
        // Note: No input.name provided, so fullName fallback is used
        const ctx = {
          state: {
            tool: { fullName: 'scope:app:allowed_tool' },
          },
        };

        Object.assign(hook, ctx);

        // Should extract base name after last colon
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });

    it('should use fullName as fallback when no other name available', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Context where only fullName is available
        const ctx = {
          state: {
            tool: { fullName: 'my-app:allowed_tool' },
          },
        };

        Object.assign(hook, ctx);

        // Should extract base name from fullName
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });
  });

  describe('authorization flow', () => {
    it('should skip when no tool name in context', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Context with no tool name at all
        const ctx = {
          state: {},
        };

        Object.assign(hook, ctx);

        // Should skip silently when no tool name
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });

    it('should skip when no active session', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      // Not in a session context
      const ctx = {
        state: {
          tool: { metadata: { name: 'some_tool' } },
        },
      };

      Object.assign(hook, ctx);

      // Should skip when no session
      await expect(
        (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
      ).resolves.not.toThrow();
    });

    it('should skip when no active skill', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        // Session exists but no skill activated
        const ctx = {
          state: {
            tool: { metadata: { name: 'some_tool' } },
          },
        };

        Object.assign(hook, ctx);

        // Should skip when no active skill
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });

    it('should check authorization using base name', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Tool not in allowlist
        const ctx = {
          state: {
            tool: { metadata: { name: 'unauthorized_tool' }, fullName: 'my-app:unauthorized_tool' },
          },
        };

        Object.assign(hook, ctx);

        // Should throw ToolNotAllowedError in strict mode
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).rejects.toThrow(ToolNotAllowedError);
      });
    });
  });

  describe('policy modes', () => {
    it('should block unapproved tools in strict mode', async () => {
      // Already using strict mode from beforeEach
      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const ctx = {
          state: {
            tool: { metadata: { name: 'unknown_tool' } },
          },
        };

        Object.assign(hook, ctx);

        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).rejects.toThrow(ToolNotAllowedError);
      });
    });

    it('should request approval in approval mode', async () => {
      sessionManager = new SkillSessionManager({ defaultPolicyMode: 'approval' }, undefined, store);

      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const ctx = {
          state: {
            tool: { metadata: { name: 'unknown_tool' } },
          },
        };

        Object.assign(hook, ctx);

        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).rejects.toThrow(ToolApprovalRequiredError);
      });
    });

    it('should allow with warning in permissive mode', async () => {
      sessionManager = new SkillSessionManager({ defaultPolicyMode: 'permissive' }, undefined, store);

      const HookClass = createSkillToolGuardHook(sessionManager, {});
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const ctx = {
          state: {
            tool: { metadata: { name: 'unknown_tool' } },
          },
        };

        Object.assign(hook, ctx);

        // Should not throw in permissive mode
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();
      });
    });
  });

  describe('approval callback', () => {
    it('should invoke onApprovalRequired callback in approval mode', async () => {
      sessionManager = new SkillSessionManager({ defaultPolicyMode: 'approval' }, undefined, store);

      const onApprovalRequired = jest.fn().mockResolvedValue(true);
      const HookClass = createSkillToolGuardHook(sessionManager, { onApprovalRequired });
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const ctx = {
          state: {
            tool: { metadata: { name: 'unknown_tool' } },
          },
        };

        Object.assign(hook, ctx);

        // Should invoke callback and allow after approval
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).resolves.not.toThrow();

        expect(onApprovalRequired).toHaveBeenCalledWith('unknown_tool', 'test-skill');
      });
    });

    it('should deny when approval callback returns false', async () => {
      sessionManager = new SkillSessionManager({ defaultPolicyMode: 'approval' }, undefined, store);

      const onApprovalRequired = jest.fn().mockResolvedValue(false);
      const HookClass = createSkillToolGuardHook(sessionManager, { onApprovalRequired });
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const ctx = {
          state: {
            tool: { metadata: { name: 'unknown_tool' } },
          },
        };

        Object.assign(hook, ctx);

        // Should throw after denial
        await expect(
          (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization(),
        ).rejects.toThrow(ToolApprovalRequiredError);
      });
    });
  });

  describe('tool call tracking', () => {
    it('should track tool calls when enabled', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, { trackToolCalls: true });
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const ctx = {
          state: {
            tool: { metadata: { name: 'allowed_tool' } },
          },
        };

        Object.assign(hook, ctx);

        await (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization();

        const session = sessionManager.getActiveSession();
        expect(session?.toolCallCount).toBe(1);
      });
    });

    it('should not track tool calls when disabled', async () => {
      const HookClass = createSkillToolGuardHook(sessionManager, { trackToolCalls: false });
      const hook = new HookClass();

      await sessionManager.runWithSession('session-1', async () => {
        sessionManager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const ctx = {
          state: {
            tool: { metadata: { name: 'allowed_tool' } },
          },
        };

        Object.assign(hook, ctx);

        await (hook as { checkSkillToolAuthorization: () => Promise<void> }).checkSkillToolAuthorization();

        const session = sessionManager.getActiveSession();
        // Tool call not recorded when tracking is disabled
        expect(session?.toolCallCount).toBe(0);
      });
    });
  });
});
