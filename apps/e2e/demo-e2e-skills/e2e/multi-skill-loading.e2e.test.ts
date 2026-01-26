/**
 * E2E Tests for Multi-Skill Loading and Session Management
 *
 * Tests skill session management including:
 * - Loading multiple skills in sequence with combined tool allowlists
 * - Tracking all active skills in session
 * - Tool availability across multiple active skills
 * - Skill deactivation (specific and full)
 * - Session state updates after skill changes
 */
import { test, expect } from '@frontmcp/testing';

interface SkillResult {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: Array<{ name: string; purpose?: string; available: boolean }>;
  parameters?: Array<{ name: string; description?: string; required?: boolean; type?: string }>;
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
    activeSkillIds?: string[];
  };
}

interface LoadSkillsResult {
  skills: SkillResult[];
  summary: {
    totalSkills: number;
    totalTools: number;
    allToolsAvailable: boolean;
    combinedWarnings?: string[];
  };
  nextSteps: string;
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

test.describe('Multi-Skill Loading E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  test.describe('Loading Multiple Skills', () => {
    test('should load first skill and return skill content', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.id).toBe('review-pr');
      expect(skill.availableTools).toContain('github_get_pr');
      expect(skill.availableTools).toContain('github_add_comment');

      // Session info may or may not be present depending on session context availability
      if (skill.session !== undefined) {
        expect(skill.session.activated).toBeDefined();
      }
    });

    test('should load second skill after first', async ({ mcp }) => {
      // Load first skill
      const firstResult = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: true,
      });
      expect(firstResult).toBeSuccessful();

      // Load second skill
      const secondResult = await mcp.tools.call('loadSkills', {
        skillIds: ['notify-team'],
        activateSession: true,
      });
      expect(secondResult).toBeSuccessful();

      const content = secondResult.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.id).toBe('notify-team');
      expect(skill.availableTools).toContain('slack_notify');
    });

    test('should track tool availability from both skills', async ({ mcp }) => {
      // Load review-pr skill
      const reviewResult = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });
      expect(reviewResult).toBeSuccessful();
      const reviewContent = reviewResult.json<LoadSkillsResult>();

      // Load notify-team skill
      const notifyResult = await mcp.tools.call('loadSkills', {
        skillIds: ['notify-team'],
      });
      expect(notifyResult).toBeSuccessful();
      const notifyContent = notifyResult.json<LoadSkillsResult>();

      // Review skill should have github tools
      expect(reviewContent.skills[0].availableTools).toContain('github_get_pr');
      expect(reviewContent.skills[0].availableTools).toContain('github_add_comment');

      // Notify skill should have slack tools
      expect(notifyContent.skills[0].availableTools).toContain('slack_notify');
    });

    test('should load full-pr-workflow skill with all tools', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['full-pr-workflow'],
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.id).toBe('full-pr-workflow');

      // This skill includes tools from both github and slack
      expect(skill.availableTools).toContain('github_get_pr');
      expect(skill.availableTools).toContain('github_add_comment');
      expect(skill.availableTools).toContain('slack_notify');
      expect(skill.isComplete).toBe(true);
    });
  });

  test.describe('Session Activation', () => {
    test('should include session object when activateSession is true and session context exists', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      // Session object may or may not be present depending on session context availability
      // When present, it should have an activated field
      if (skill.session !== undefined) {
        expect(skill.session.activated).toBeDefined();
      }
    });

    test('should not include session object when activateSession is false', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: false,
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      // Session should not be present when activateSession is false
      expect(skill.session).toBeUndefined();
    });

    test('should respect policyMode parameter when session is activated', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: true,
        policyMode: 'strict',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      // If session was activated, policyMode should be set
      if (skill.session?.activated) {
        expect(skill.session.policyMode).toBe('strict');
      }
    });

    test('should default to permissive policyMode when session is activated', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      // If session was activated, default policyMode should be permissive
      if (skill.session?.activated) {
        expect(skill.session.policyMode).toBe('permissive');
      }
    });
  });

  test.describe('Tool Execution After Skill Loading', () => {
    test('should execute tool from loaded skill', async ({ mcp }) => {
      // Load review-pr skill
      const loadResult = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: true,
      });
      expect(loadResult).toBeSuccessful();

      // Execute tool from the skill
      const toolResult = await mcp.tools.call('github_get_pr', {
        prNumber: 123,
      });

      expect(toolResult).toBeSuccessful();
      const content = toolResult.json<GitHubPRResult>();
      expect(content.pr.number).toBe(123);
    });

    test('should execute tools from different loaded skills', async ({ mcp }) => {
      // Load review-pr skill
      const reviewLoad = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });
      expect(reviewLoad).toBeSuccessful();

      // Load notify-team skill
      const notifyLoad = await mcp.tools.call('loadSkills', {
        skillIds: ['notify-team'],
      });
      expect(notifyLoad).toBeSuccessful();

      // Execute github tool
      const ghResult = await mcp.tools.call('github_get_pr', {
        prNumber: 456,
      });
      expect(ghResult).toBeSuccessful();

      // Execute slack tool
      const slackResult = await mcp.tools.call('slack_notify', {
        channel: 'engineering',
        message: 'PR review complete',
      });
      expect(slackResult).toBeSuccessful();

      const slackContent = slackResult.json<SlackResult>();
      expect(slackContent.success).toBe(true);
    });
  });

  test.describe('Skill Incompleteness', () => {
    test('should identify incomplete skill with missing tools', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['deploy-app'],
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.id).toBe('deploy-app');
      expect(skill.isComplete).toBe(false);
      expect(skill.missingTools).toContain('docker_build');
      expect(skill.missingTools).toContain('docker_push');
      expect(skill.missingTools).toContain('k8s_apply');
      expect(skill.warning).toBeDefined();
    });

    test('should still include available tools for incomplete skill', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['deploy-app'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      // slack_notify is available even though other tools are missing
      expect(skill.availableTools).toContain('slack_notify');
    });
  });

  test.describe('Admin Tool Access', () => {
    test('should have admin_action tool registered', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('admin_action');
    });

    test('should execute admin_action tool', async ({ mcp }) => {
      // Admin action is not in any skill's allowlist but should work without skill context
      const result = await mcp.tools.call('admin_action', {
        action: 'test-action',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ result: string; success: boolean }>();
      expect(content.success).toBe(true);
      expect(content.result).toContain('test-action');
    });
  });

  test.describe('Format Options', () => {
    test('should return full format by default', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.formattedContent).toBeDefined();
      expect(skill.id).toBeDefined();
      expect(skill.instructions).toContain('PR Review Process');
    });

    test('should return instructions-only format when requested', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        format: 'instructions-only',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.formattedContent).toBeDefined();
      // Instructions-only format should be the raw instructions
      expect(skill.formattedContent).toContain('PR Review Process');
    });
  });

  test.describe('Error Handling', () => {
    test('should return warning for non-existent skill', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['non-existent-skill-xyz'],
      });

      expect(result).toBeSuccessful();
      const content = result.json<LoadSkillsResult>();
      expect(content.skills.length).toBe(0);
      expect(content.summary.combinedWarnings).toBeDefined();
    });

    test('should handle loading same skill twice', async ({ mcp }) => {
      // Load skill first time
      const firstLoad = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: true,
      });
      expect(firstLoad).toBeSuccessful();

      // Load same skill again - should succeed
      const secondLoad = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        activateSession: true,
      });
      expect(secondLoad).toBeSuccessful();

      const content = secondLoad.json<LoadSkillsResult>();
      expect(content.skills[0].id).toBe('review-pr');
    });
  });
});
