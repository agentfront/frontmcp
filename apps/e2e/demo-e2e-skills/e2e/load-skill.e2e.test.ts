/**
 * E2E Tests for loadSkills Tool
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

interface SkillResult {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: SkillTool[];
  parameters?: SkillParameter[];
  availableTools: string[];
  missingTools: string[];
  isComplete: boolean;
  warning?: string;
  formattedContent: string;
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

test.describe('loadSkills E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  test.describe('Load Skill by ID', () => {
    test('should load skill with full content', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      expect(content.skills).toBeDefined();
      expect(content.skills.length).toBe(1);
      const skill = content.skills[0];
      expect(skill.id).toBe('review-pr');
      expect(skill.name).toBe('review-pr');
      expect(skill.description).toBeDefined();
      expect(skill.instructions).toBeDefined();
      expect(skill.instructions).toContain('github_get_pr');
    });

    test('should include instructions content', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.instructions).toContain('PR Review Process');
      expect(skill.instructions).toContain('github_add_comment');
    });

    test('should include formatted content for LLM', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.formattedContent).toBeDefined();
      expect(typeof skill.formattedContent).toBe('string');
      expect(skill.formattedContent.length).toBeGreaterThan(0);
    });
  });

  test.describe('Tool Availability', () => {
    test('should include available tools list', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.availableTools).toBeDefined();
      expect(Array.isArray(skill.availableTools)).toBe(true);

      // github_get_pr and github_add_comment should be available
      expect(skill.availableTools).toContain('github_get_pr');
      expect(skill.availableTools).toContain('github_add_comment');
    });

    test('should include missing tools list', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['deploy-app'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.missingTools).toBeDefined();
      expect(Array.isArray(skill.missingTools)).toBe(true);

      // docker_build, docker_push, k8s_apply are not registered
      expect(skill.missingTools).toContain('docker_build');
      expect(skill.missingTools).toContain('docker_push');
      expect(skill.missingTools).toContain('k8s_apply');
    });

    test('should set isComplete flag based on tool availability', async ({ mcp }) => {
      // Skill with all tools available
      const completeResult = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(completeResult).toBeSuccessful();
      const completeContent = completeResult.json<LoadSkillsResult>();
      expect(completeContent.skills[0].isComplete).toBe(true);

      // Skill with missing tools
      const incompleteResult = await mcp.tools.call('loadSkills', {
        skillIds: ['deploy-app'],
      });

      expect(incompleteResult).toBeSuccessful();
      const incompleteContent = incompleteResult.json<LoadSkillsResult>();
      expect(incompleteContent.skills[0].isComplete).toBe(false);
    });

    test('should include warning for missing tools', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['deploy-app'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.warning).toBeDefined();
      expect(skill.warning).toContain('missing');
    });

    test('should include tools with availability in skill object', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.tools).toBeDefined();
      expect(Array.isArray(skill.tools)).toBe(true);

      for (const tool of skill.tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.available).toBe('boolean');
      }
    });
  });

  test.describe('Tool Purposes', () => {
    test('should include tool purposes when defined', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      const githubGetPr = skill.tools.find((t) => t.name === 'github_get_pr');

      expect(githubGetPr).toBeDefined();
      expect(githubGetPr?.purpose).toBeDefined();
      expect(githubGetPr?.purpose).toContain('Fetch PR details');
    });
  });

  test.describe('Parameters', () => {
    test('should include skill parameters', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.parameters).toBeDefined();
      expect(Array.isArray(skill.parameters)).toBe(true);

      // Should have pr_url parameter
      const prUrlParam = skill.parameters?.find((p) => p.name === 'pr_url');
      expect(prUrlParam).toBeDefined();
      expect(prUrlParam?.required).toBe(true);
      expect(prUrlParam?.type).toBe('string');
    });
  });

  test.describe('Hidden Skills', () => {
    test('should load hidden skills directly by ID', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['hidden-internal'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      expect(content.skills).toBeDefined();
      expect(content.skills.length).toBe(1);
      expect(content.skills[0].name).toBe('hidden-internal');
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
      // Full format includes formattedContent with full skill details
      expect(skill.formattedContent).toBeDefined();
      expect(skill.id).toBeDefined();
    });

    test('should return instructions-only format when requested', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['review-pr'],
        format: 'instructions-only',
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      // Instructions-only format has simpler formattedContent
      expect(skill.formattedContent).toBeDefined();
      // formattedContent should be the raw instructions
      expect(skill.formattedContent).toContain('PR Review Process');
    });
  });

  test.describe('Error Handling', () => {
    test('should return error for non-existent skill', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['non-existent-skill-xyz-12345'],
      });

      // When all skills fail to load, the tool returns empty skills array with warning
      expect(result).toBeSuccessful();
      const content = result.json<LoadSkillsResult>();
      expect(content.skills.length).toBe(0);
      expect(content.summary.combinedWarnings).toBeDefined();
      expect(content.summary.combinedWarnings?.some((w) => w.includes('not found'))).toBe(true);
    });
  });

  test.describe('Skill with Simple Tool References', () => {
    test('should load skill with simple string tool references', async ({ mcp }) => {
      const result = await mcp.tools.call('loadSkills', {
        skillIds: ['notify-team'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<LoadSkillsResult>();
      const skill = content.skills[0];
      expect(skill.name).toBe('notify-team');
      expect(skill.availableTools).toContain('slack_notify');
      expect(skill.isComplete).toBe(true);
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list loadSkills tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('loadSkills');
    });
  });
});
