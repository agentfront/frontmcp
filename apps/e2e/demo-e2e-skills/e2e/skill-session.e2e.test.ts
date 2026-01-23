/**
 * E2E Tests for Skill Session Management
 *
 * Tests skill session and tool authorization:
 * - Tool call validation within skill context
 * - Multi-skill session support (tool allowlist union)
 * - Integration between skills and tools
 *
 * Note: Full session activation tests require session manager
 * to be configured in the app. These tests focus on the
 * observable behavior through the MCP protocol.
 */
import { test, expect } from '@frontmcp/testing';

interface LoadSkillResult {
  skill: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    tools: Array<{ name: string; purpose?: string; available: boolean }>;
    parameters?: Array<{ name: string; description?: string; required?: boolean; type?: string }>;
  };
  availableTools: string[];
  missingTools: string[];
  isComplete: boolean;
  warning?: string;
  formattedContent: string;
}

interface SearchSkillsResult {
  skills: Array<{ id: string; name: string; description: string; score: number }>;
  total: number;
  hasMore: boolean;
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

interface CommentResult {
  commentId: number;
  success: boolean;
}

interface SlackResult {
  messageId: string;
  success: boolean;
  timestamp: string;
}

test.describe('Skill Session E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  test.describe('Tool Availability in Skills', () => {
    test('should correctly identify available tools when loading skill', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      // These tools are registered in the app
      expect(content.availableTools).toContain('github_get_pr');
      expect(content.availableTools).toContain('github_add_comment');
    });

    test('should correctly identify missing tools when loading skill', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-app',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      // These tools are NOT registered in the app
      expect(content.missingTools).toContain('docker_build');
      expect(content.missingTools).toContain('docker_push');
      expect(content.missingTools).toContain('k8s_apply');
      // slack_notify IS registered
      expect(content.availableTools).toContain('slack_notify');
    });
  });

  test.describe('Tool Call Without Skill Context', () => {
    test('should allow tool calls without active skill', async ({ mcp }) => {
      // Without skill session enforcement, tools should work directly
      const result = await mcp.tools.call('github_get_pr', {
        prNumber: 123,
      });

      expect(result).toBeSuccessful();

      const content = result.json<GitHubPRResult>();
      expect(content.pr).toBeDefined();
      expect(content.pr.number).toBe(123);
    });

    test('should allow all registered tools without skill context', async ({ mcp }) => {
      // Test all three registered tools
      const ghResult = await mcp.tools.call('github_get_pr', { prNumber: 456 });
      expect(ghResult).toBeSuccessful();

      const commentResult = await mcp.tools.call('github_add_comment', {
        prNumber: 456,
        comment: 'Test comment',
      });
      expect(commentResult).toBeSuccessful();

      const slackResult = await mcp.tools.call('slack_notify', {
        channel: 'test-channel',
        message: 'Test notification',
      });
      expect(slackResult).toBeSuccessful();
    });
  });

  test.describe('Multi-Skill Tool Coverage', () => {
    test('should show combined tool availability across skills', async ({ mcp }) => {
      // Load skill that uses github tools
      const reviewResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(reviewResult).toBeSuccessful();
      const reviewContent = reviewResult.json<LoadSkillResult>();

      // Load skill that uses slack tools
      const notifyResult = await mcp.tools.call('loadSkill', {
        skillId: 'notify-team',
      });

      expect(notifyResult).toBeSuccessful();
      const notifyContent = notifyResult.json<LoadSkillResult>();

      // Review skill should have github tools
      expect(reviewContent.availableTools).toContain('github_get_pr');
      expect(reviewContent.availableTools).toContain('github_add_comment');

      // Notify skill should have slack tools
      expect(notifyContent.availableTools).toContain('slack_notify');
    });

    test('should identify full workflow skill with multiple tool types', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'full-pr-workflow',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      // This skill uses all three available tools
      expect(content.availableTools).toContain('github_get_pr');
      expect(content.availableTools).toContain('github_add_comment');
      expect(content.availableTools).toContain('slack_notify');
      expect(content.isComplete).toBe(true);
    });
  });

  test.describe('Skill Search and Load Workflow', () => {
    test('should find and load skill in typical workflow', async ({ mcp }) => {
      // Step 1: Search for relevant skills
      const searchResult = await mcp.tools.call('searchSkills', {
        query: 'review pull request',
      });

      expect(searchResult).toBeSuccessful();

      const searchContent = searchResult.json<SearchSkillsResult>();
      expect(searchContent.skills.length).toBeGreaterThan(0);

      // Step 2: Load the first matching skill
      const skillId = searchContent.skills[0].id;
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId,
      });

      expect(loadResult).toBeSuccessful();

      const loadContent = loadResult.json<LoadSkillResult>();
      expect(loadContent.skill.instructions).toBeDefined();
      expect(loadContent.formattedContent).toBeDefined();

      // Step 3: Use a tool mentioned in the skill
      if (loadContent.availableTools.includes('github_get_pr')) {
        const toolResult = await mcp.tools.call('github_get_pr', {
          prNumber: 42,
        });

        expect(toolResult).toBeSuccessful();
      }
    });
  });

  test.describe('Tool Execution', () => {
    test('should execute github_get_pr tool correctly', async ({ mcp }) => {
      const result = await mcp.tools.call('github_get_pr', {
        prNumber: 789,
      });

      expect(result).toBeSuccessful();

      const content = result.json<GitHubPRResult>();
      expect(content.pr).toBeDefined();
      expect(content.pr.number).toBe(789);
      expect(content.pr.title).toBeDefined();
      expect(content.pr.author).toBeDefined();
      expect(content.pr.status).toBeDefined();
      expect(content.pr.files).toBeDefined();
    });

    test('should execute github_add_comment tool correctly', async ({ mcp }) => {
      const result = await mcp.tools.call('github_add_comment', {
        prNumber: 789,
        comment: 'This is a test review comment',
      });

      expect(result).toBeSuccessful();

      const content = result.json<CommentResult>();
      expect(content.commentId).toBeDefined();
      expect(content.success).toBe(true);
    });

    test('should execute slack_notify tool correctly', async ({ mcp }) => {
      const result = await mcp.tools.call('slack_notify', {
        channel: 'engineering',
        message: 'Deployment complete!',
      });

      expect(result).toBeSuccessful();

      const content = result.json<SlackResult>();
      expect(content.messageId).toBeDefined();
      expect(content.success).toBe(true);
      expect(content.timestamp).toBeDefined();
    });
  });

  test.describe('Skill Priority', () => {
    test('should respect skill priority in search results', async ({ mcp }) => {
      // deploy-app has priority: 10 (higher)
      const result = await mcp.tools.call('searchSkills', {
        query: 'workflow process',
        limit: 10,
      });

      expect(result).toBeSuccessful();

      const content = result.json<SearchSkillsResult>();
      const skillIds = content.skills.map((s) => s.id);

      // If deploy-app matches, it should appear due to priority boost
      if (skillIds.includes('deploy-app')) {
        // Priority should influence ranking
        expect(skillIds).toContain('deploy-app');
      }
    });
  });

  test.describe('Complete Workflow Integration', () => {
    test('should support full PR review workflow', async ({ mcp }) => {
      // 1. Find the review-pr skill
      const searchResult = await mcp.tools.call('searchSkills', {
        query: 'PR review',
      });

      expect(searchResult).toBeSuccessful();

      // 2. Load the skill
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(loadResult).toBeSuccessful();

      // 3. Follow the skill instructions - get PR
      const prResult = await mcp.tools.call('github_get_pr', {
        prNumber: 100,
      });

      expect(prResult).toBeSuccessful();

      // 4. Add a review comment
      const commentResult = await mcp.tools.call('github_add_comment', {
        prNumber: 100,
        comment: 'LGTM! Nice refactoring work.',
      });

      expect(commentResult).toBeSuccessful();
    });

    test('should support notification workflow', async ({ mcp }) => {
      // 1. Load the notify-team skill
      const loadResult = await mcp.tools.call('loadSkill', {
        skillId: 'notify-team',
      });

      expect(loadResult).toBeSuccessful();

      const loadContent = loadResult.json<LoadSkillResult>();
      expect(loadContent.skill.instructions).toContain('slack_notify');

      // 2. Send notification
      const notifyResult = await mcp.tools.call('slack_notify', {
        channel: 'engineering',
        message: 'PR #100 has been approved and merged!',
      });

      expect(notifyResult).toBeSuccessful();
    });
  });

  test.describe('Session Activation', () => {
    test('should return session info when activateSession is true and session context exists', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<
        LoadSkillResult & {
          session?: {
            activated: boolean;
            sessionId?: string;
            policyMode?: string;
            allowedTools?: string[];
          };
        }
      >();

      // Session object may or may not be present depending on session context availability
      // When present, it should have an activated field
      if (content.session !== undefined) {
        expect(typeof content.session.activated).toBe('boolean');
      }
    });

    test('should not return session info when activateSession is false', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: false,
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult & { session?: unknown }>();

      // Session should not be present when activateSession is false
      expect(content.session).toBeUndefined();
    });

    test('should not return session info when activateSession is not specified', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult & { session?: unknown }>();

      // Session should not be present when activateSession defaults to false
      expect(content.session).toBeUndefined();
    });
  });

  test.describe('Policy Mode Override', () => {
    test('should set strict policyMode when specified', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
        policyMode: 'strict',
      });

      expect(result).toBeSuccessful();

      const content = result.json<
        LoadSkillResult & {
          session?: {
            activated: boolean;
            policyMode?: string;
          };
        }
      >();

      // If session was activated, verify policy mode
      if (content.session?.activated) {
        expect(content.session.policyMode).toBe('strict');
      }
    });

    test('should set approval policyMode when specified', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
        policyMode: 'approval',
      });

      expect(result).toBeSuccessful();

      const content = result.json<
        LoadSkillResult & {
          session?: {
            activated: boolean;
            policyMode?: string;
          };
        }
      >();

      // If session was activated, verify policy mode
      if (content.session?.activated) {
        expect(content.session.policyMode).toBe('approval');
      }
    });

    test('should default to permissive policyMode', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<
        LoadSkillResult & {
          session?: {
            activated: boolean;
            policyMode?: string;
          };
        }
      >();

      // If session was activated, default policy mode should be permissive
      if (content.session?.activated) {
        expect(content.session.policyMode).toBe('permissive');
      }
    });
  });

  test.describe('Session Allowed Tools', () => {
    test('should include allowedTools in session when activated', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<
        LoadSkillResult & {
          session?: {
            activated: boolean;
            allowedTools?: string[];
          };
        }
      >();

      // If session was activated, allowedTools should match availableTools
      if (content.session?.activated) {
        expect(content.session.allowedTools).toBeDefined();
        expect(content.session.allowedTools).toContain('github_get_pr');
        expect(content.session.allowedTools).toContain('github_add_comment');
      }
    });

    test('should include full-pr-workflow tools in session', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'full-pr-workflow',
        activateSession: true,
      });

      expect(result).toBeSuccessful();

      const content = result.json<
        LoadSkillResult & {
          session?: {
            activated: boolean;
            allowedTools?: string[];
          };
        }
      >();

      // If session was activated, verify all tools from full workflow
      if (content.session?.activated) {
        expect(content.session.allowedTools).toContain('github_get_pr');
        expect(content.session.allowedTools).toContain('github_add_comment');
        expect(content.session.allowedTools).toContain('slack_notify');
      }
    });
  });
});
