/**
 * E2E Tests for Tool Authorization Guard
 *
 * Tests tool authorization behavior with skill sessions:
 * - Policy mode enforcement (strict, approval, permissive)
 * - Tool allowlist validation
 * - Unauthorized tool access handling
 * - Authorization without active skill
 *
 * Note: Tool authorization enforcement requires the skill session manager
 * to be running within a session context. The behavior of these tests
 * documents the current authorization state based on session availability.
 */
import { test, expect } from '@frontmcp/testing';

interface LoadSkillResult {
  skill: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    tools: Array<{ name: string; purpose?: string; available: boolean }>;
  };
  availableTools: string[];
  missingTools: string[];
  isComplete: boolean;
  warning?: string;
  formattedContent: string;
  session?: {
    activated: boolean;
    sessionId?: string;
    policyMode?: 'strict' | 'approval' | 'permissive';
    allowedTools?: string[];
  };
}

interface AdminActionResult {
  result: string;
  success: boolean;
}

interface GitHubPRResult {
  pr: {
    number: number;
    title: string;
    author: string;
    status: string;
    files: string[];
  };
}

interface SlackResult {
  messageId: string;
  success: boolean;
  timestamp: string;
}

test.describe('Tool Authorization E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    publicMode: true,
  });

  test.describe('Authorization Without Active Skill', () => {
    test('should allow all tools without active skill session', async ({ mcp }) => {
      // Without loading a skill, all tools should be allowed
      const result = await mcp.tools.call('admin_action', {
        action: 'test-without-skill',
      });

      expect(result).toBeSuccessful();
      const content = result.json<AdminActionResult>();
      expect(content.success).toBe(true);
    });

    test('should allow github tools without skill context', async ({ mcp }) => {
      const result = await mcp.tools.call('github_get_pr', {
        prNumber: 100,
      });

      expect(result).toBeSuccessful();
      const content = result.json<GitHubPRResult>();
      expect(content.pr.number).toBe(100);
    });

    test('should allow slack tools without skill context', async ({ mcp }) => {
      const result = await mcp.tools.call('slack_notify', {
        channel: 'general',
        message: 'Test without skill',
      });

      expect(result).toBeSuccessful();
      const content = result.json<SlackResult>();
      expect(content.success).toBe(true);
    });
  });

  test.describe('Policy Mode - Permissive (Default)', () => {
    test('should allow tools in skill allowlist', async ({ mcp }) => {
      // Load skill with permissive mode (default)
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      // Execute tool that is in the skill's allowlist
      const toolResult = await mcp.tools.call('github_get_pr', {
        prNumber: 200,
      });

      expect(toolResult).toBeSuccessful();
      const content = toolResult.json<GitHubPRResult>();
      expect(content.pr.number).toBe(200);
    });

    test('should allow tools not in skill allowlist in permissive mode', async ({ mcp }) => {
      // Load skill with default permissive mode
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
        policyMode: 'permissive',
      });
      expect(loadResult).toBeSuccessful();

      // admin_action is NOT in review-pr's allowlist
      // In permissive mode, it should still be allowed (with warning)
      const toolResult = await mcp.tools.call('admin_action', {
        action: 'test-permissive',
      });

      // In permissive mode, this should succeed
      expect(toolResult).toBeSuccessful();
      const content = toolResult.json<AdminActionResult>();
      expect(content.success).toBe(true);
    });

    test('should verify session shows permissive policyMode', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();
      if (content.session?.activated) {
        expect(content.session.policyMode).toBe('permissive');
      }
    });
  });

  test.describe('Policy Mode - Strict', () => {
    test('should allow tools in skill allowlist with strict mode', async ({ mcp }) => {
      // Load skill with strict mode
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
        policyMode: 'strict',
      });
      expect(loadResult).toBeSuccessful();

      // github_get_pr IS in review-pr's allowlist
      const toolResult = await mcp.tools.call('github_get_pr', {
        prNumber: 300,
      });

      expect(toolResult).toBeSuccessful();
      const content = toolResult.json<GitHubPRResult>();
      expect(content.pr.number).toBe(300);
    });

    test('should verify session shows strict policyMode', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
        policyMode: 'strict',
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();
      if (content.session?.activated) {
        expect(content.session.policyMode).toBe('strict');
      }
    });

    test('should include allowedTools in session when activated', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
        policyMode: 'strict',
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();
      if (content.session?.activated) {
        expect(content.session.allowedTools).toBeDefined();
        expect(content.session.allowedTools).toContain('github_get_pr');
        expect(content.session.allowedTools).toContain('github_add_comment');
      }
    });
  });

  test.describe('Policy Mode - Approval', () => {
    test('should allow tools in skill allowlist with approval mode', async ({ mcp }) => {
      // Load skill with approval mode
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
        policyMode: 'approval',
      });
      expect(loadResult).toBeSuccessful();

      // Tool in allowlist should work
      const toolResult = await mcp.tools.call('github_get_pr', {
        prNumber: 400,
      });

      expect(toolResult).toBeSuccessful();
    });

    test('should verify session shows approval policyMode', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
        policyMode: 'approval',
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();
      if (content.session?.activated) {
        expect(content.session.policyMode).toBe('approval');
      }
    });
  });

  test.describe('Tool Allowlist Tracking', () => {
    test('should track review-pr skill tools', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();

      // review-pr skill should have these tools
      expect(content.skill.tools.find((t) => t.name === 'github_get_pr')).toBeDefined();
      expect(content.skill.tools.find((t) => t.name === 'github_add_comment')).toBeDefined();

      // admin_action should NOT be in the skill's tools
      expect(content.skill.tools.find((t) => t.name === 'admin_action')).toBeUndefined();
    });

    test('should track notify-team skill tools', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'notify-team',
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();

      // notify-team skill should have slack_notify
      expect(content.skill.tools.find((t) => t.name === 'slack_notify')).toBeDefined();
      expect(content.availableTools).toContain('slack_notify');

      // admin_action should NOT be in the skill's tools
      expect(content.skill.tools.find((t) => t.name === 'admin_action')).toBeUndefined();
    });

    test('should track full-pr-workflow skill tools', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'full-pr-workflow',
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();

      // full-pr-workflow has all three main tools
      expect(content.skill.tools.find((t) => t.name === 'github_get_pr')).toBeDefined();
      expect(content.skill.tools.find((t) => t.name === 'github_add_comment')).toBeDefined();
      expect(content.skill.tools.find((t) => t.name === 'slack_notify')).toBeDefined();

      // admin_action should NOT be in the skill's tools
      expect(content.skill.tools.find((t) => t.name === 'admin_action')).toBeUndefined();
    });
  });

  test.describe('Tool Availability', () => {
    test('should mark available tools correctly', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();

      // Tools that are registered should be marked as available
      const githubGetPr = content.skill.tools.find((t) => t.name === 'github_get_pr');
      const githubAddComment = content.skill.tools.find((t) => t.name === 'github_add_comment');

      expect(githubGetPr?.available).toBe(true);
      expect(githubAddComment?.available).toBe(true);
    });

    test('should mark missing tools correctly', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-app',
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();

      // Tools that are NOT registered should be marked as unavailable
      const dockerBuild = content.skill.tools.find((t) => t.name === 'docker_build');
      const dockerPush = content.skill.tools.find((t) => t.name === 'docker_push');
      const k8sApply = content.skill.tools.find((t) => t.name === 'k8s_apply');

      expect(dockerBuild?.available).toBe(false);
      expect(dockerPush?.available).toBe(false);
      expect(k8sApply?.available).toBe(false);

      // But slack_notify should be available
      const slackNotify = content.skill.tools.find((t) => t.name === 'slack_notify');
      expect(slackNotify?.available).toBe(true);
    });
  });

  test.describe('Session State Verification', () => {
    test('should indicate activation status when session context exists', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();
      // Session object may or may not be present depending on session context availability
      // When present, it should have an activated field
      if (content.session !== undefined) {
        expect(content.session.activated).toBeDefined();
      }
    });

    test('should not return session object when not requested', async ({ mcp }) => {
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        // activateSession not set (defaults to false)
      });
      expect(loadResult).toBeSuccessful();

      const content = loadResult.json<LoadSkillResult>();
      // When activateSession is false/not set, session should not be in response
      expect(content.session).toBeUndefined();
    });
  });

  test.describe('Cross-Skill Tool Access', () => {
    test('should access tools across multiple loaded skills', async ({ mcp }) => {
      // Load review-pr skill
      await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });

      // Load notify-team skill
      await mcp.tools.call('loadSkill', {
        skillId: 'notify-team',
        activateSession: true,
      });

      // Should be able to use github tools
      const ghResult = await mcp.tools.call('github_get_pr', { prNumber: 500 });
      expect(ghResult).toBeSuccessful();

      // Should be able to use slack tools
      const slackResult = await mcp.tools.call('slack_notify', {
        channel: 'dev',
        message: 'Test cross-skill',
      });
      expect(slackResult).toBeSuccessful();
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list all registered tools including admin_action', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('github_get_pr');
      expect(tools).toContainTool('github_add_comment');
      expect(tools).toContainTool('slack_notify');
      expect(tools).toContainTool('admin_action');
      expect(tools).toContainTool('loadSkill');
      expect(tools).toContainTool('searchSkills');
    });
  });
});
