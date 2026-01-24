/**
 * E2E Tests for loadSkill Tool
 *
 * Tests skill loading functionality:
 * - Loading skill by ID/name
 * - Full content retrieval
 * - Tool availability information
 * - Hidden skill loading (direct access)
 * - Error handling for missing skills
 * - Format options
 */
import { test, expect } from '@frontmcp/testing';

interface SkillTool {
  name: string;
  purpose?: string;
  available: boolean;
}

interface SkillParameter {
  name: string;
  description?: string;
  required?: boolean;
  type?: string;
}

interface LoadSkillResult {
  skill: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    tools: SkillTool[];
    parameters?: SkillParameter[];
  };
  availableTools: string[];
  missingTools: string[];
  isComplete: boolean;
  warning?: string;
  formattedContent: string;
}

test.describe('loadSkill E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  test.describe('Load Skill by ID', () => {
    test('should load skill with full content', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.skill).toBeDefined();
      expect(content.skill.id).toBe('review-pr');
      expect(content.skill.name).toBe('review-pr');
      expect(content.skill.description).toBeDefined();
      expect(content.skill.instructions).toBeDefined();
      expect(content.skill.instructions).toContain('github_get_pr');
    });

    test('should include instructions content', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.skill.instructions).toContain('PR Review Process');
      expect(content.skill.instructions).toContain('github_add_comment');
    });

    test('should include formatted content for LLM', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.formattedContent).toBeDefined();
      expect(typeof content.formattedContent).toBe('string');
      expect(content.formattedContent.length).toBeGreaterThan(0);
    });
  });

  test.describe('Tool Availability', () => {
    test('should include available tools list', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.availableTools).toBeDefined();
      expect(Array.isArray(content.availableTools)).toBe(true);

      // github_get_pr and github_add_comment should be available
      expect(content.availableTools).toContain('github_get_pr');
      expect(content.availableTools).toContain('github_add_comment');
    });

    test('should include missing tools list', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-app',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.missingTools).toBeDefined();
      expect(Array.isArray(content.missingTools)).toBe(true);

      // docker_build, docker_push, k8s_apply are not registered
      expect(content.missingTools).toContain('docker_build');
      expect(content.missingTools).toContain('docker_push');
      expect(content.missingTools).toContain('k8s_apply');
    });

    test('should set isComplete flag based on tool availability', async ({ mcp }) => {
      // Skill with all tools available
      const completeResult = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(completeResult).toBeSuccessful();
      const completeContent = completeResult.json<LoadSkillResult>();
      expect(completeContent.isComplete).toBe(true);

      // Skill with missing tools
      const incompleteResult = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-app',
      });

      expect(incompleteResult).toBeSuccessful();
      const incompleteContent = incompleteResult.json<LoadSkillResult>();
      expect(incompleteContent.isComplete).toBe(false);
    });

    test('should include warning for missing tools', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'deploy-app',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.warning).toBeDefined();
      expect(content.warning).toContain('missing');
    });

    test('should include tools with availability in skill object', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.skill.tools).toBeDefined();
      expect(Array.isArray(content.skill.tools)).toBe(true);

      for (const tool of content.skill.tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.available).toBe('boolean');
      }
    });
  });

  test.describe('Tool Purposes', () => {
    test('should include tool purposes when defined', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      const githubGetPr = content.skill.tools.find((t) => t.name === 'github_get_pr');

      expect(githubGetPr).toBeDefined();
      expect(githubGetPr!.purpose).toBeDefined();
      expect(githubGetPr!.purpose).toContain('Fetch PR details');
    });
  });

  test.describe('Parameters', () => {
    test('should include skill parameters', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.skill.parameters).toBeDefined();
      expect(Array.isArray(content.skill.parameters)).toBe(true);

      // Should have pr_url parameter
      const prUrlParam = content.skill.parameters!.find((p) => p.name === 'pr_url');
      expect(prUrlParam).toBeDefined();
      expect(prUrlParam!.required).toBe(true);
      expect(prUrlParam!.type).toBe('string');
    });
  });

  test.describe('Hidden Skills', () => {
    test('should load hidden skills directly by ID', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'hidden-internal',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.skill).toBeDefined();
      expect(content.skill.name).toBe('hidden-internal');
    });
  });

  test.describe('Format Options', () => {
    test('should return full format by default', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      // Full format includes formattedContent with full skill details
      expect(content.formattedContent).toBeDefined();
      expect(content.skill).toBeDefined();
    });

    test('should return instructions-only format when requested', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'review-pr',
        format: 'instructions-only',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      // Instructions-only format has simpler formattedContent
      expect(content.formattedContent).toBeDefined();
      // formattedContent should be the raw instructions
      expect(content.formattedContent).toContain('PR Review Process');
    });
  });

  test.describe('Error Handling', () => {
    test('should return error for non-existent skill', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'non-existent-skill-xyz-12345',
      });

      expect(result).toBeError();
    });
  });

  test.describe('Skill with Simple Tool References', () => {
    test('should load skill with simple string tool references', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkill', {
        skillId: 'notify-team',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillResult>();
      expect(content.skill.name).toBe('notify-team');
      expect(content.availableTools).toContain('slack_notify');
      expect(content.isComplete).toBe(true);
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list loadSkill tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('loadSkill');
    });
  });
});
