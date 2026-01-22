/**
 * E2E Tests for searchSkills Tool
 *
 * Tests skill discovery functionality:
 * - Query-based search using TF-IDF
 * - Tag filtering
 * - Tool filtering
 * - Hidden skills exclusion
 * - Result limit
 */
import { test, expect } from '@frontmcp/testing';

test.describe('searchSkills E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    publicMode: true,
  });

  test.describe('Query-Based Search', () => {
    test('should find skills by query matching description', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'code review github',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: Array<{ id: string }> }>();
      expect(content.skills).toBeDefined();
      expect(content.skills.length).toBeGreaterThan(0);

      // Should find review-pr skill
      const skillIds = content.skills.map((s) => s.id);
      expect(skillIds).toContain('review-pr');
    });

    test('should find skills by query matching tags', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'deployment kubernetes',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: Array<{ id: string }> }>();
      expect(content.skills).toBeDefined();

      // Should find deploy-app skill
      const skillIds = content.skills.map((s) => s.id);
      expect(skillIds).toContain('deploy-app');
    });

    test('should return relevance scores', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'pull request review',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: Array<{ score: number }> }>();
      expect(content.skills).toBeDefined();
      expect(content.skills.length).toBeGreaterThan(0);

      // Each skill should have a score
      for (const skill of content.skills) {
        expect(skill.score).toBeDefined();
        expect(typeof skill.score).toBe('number');
        expect(skill.score).toBeGreaterThanOrEqual(0);
      }
    });
  });

  test.describe('Tag Filtering', () => {
    test('should filter skills by single tag', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'workflow',
        tags: ['slack'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: Array<{ tags?: string[] }> }>();
      expect(content.skills).toBeDefined();

      // All returned skills should have the 'slack' tag
      for (const skill of content.skills) {
        expect(skill.tags ?? []).toContain('slack');
      }
    });

    test('should filter skills by multiple tags', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'review',
        tags: ['github', 'code-review'],
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: Array<{ id: string }> }>();
      expect(content.skills).toBeDefined();

      // Should find skills with matching tags
      const skillIds = content.skills.map((s) => s.id);
      expect(skillIds).toContain('review-pr');
    });
  });

  test.describe('Hidden Skills', () => {
    test('should not return hidden skills in search results', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'internal system operations',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: Array<{ id: string }> }>();
      const skillIds = content.skills.map((s) => s.id);

      // Hidden skill should not appear in results
      expect(skillIds).not.toContain('hidden-internal');
    });

    test('should not return hidden skills even with exact name match', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'hidden-internal',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: Array<{ id: string }> }>();
      const skillIds = content.skills.map((s) => s.id);

      expect(skillIds).not.toContain('hidden-internal');
    });
  });

  test.describe('Result Limit', () => {
    test('should respect limit parameter', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'github slack',
        limit: 2,
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: unknown[] }>();
      expect(content.skills.length).toBeLessThanOrEqual(2);
    });

    test('should return hasMore indicator when more results exist', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'workflow',
        limit: 1,
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ hasMore: boolean }>();
      // hasMore should indicate if there are more skills than returned
      expect(typeof content.hasMore).toBe('boolean');
    });
  });

  test.describe('Tool Information', () => {
    test('should include tool availability info in results', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{
        skills: Array<{ id: string; tools: Array<{ name: string; available: boolean }> }>;
      }>();
      const reviewPrSkill = content.skills.find((s) => s.id === 'review-pr');

      expect(reviewPrSkill).toBeDefined();
      expect(reviewPrSkill!.tools).toBeDefined();
      expect(reviewPrSkill!.tools.length).toBeGreaterThan(0);

      // Check tool availability
      for (const tool of reviewPrSkill!.tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.available).toBe('boolean');
      }
    });

    test('should mark available tools correctly', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{
        skills: Array<{ id: string; tools: Array<{ name: string; available: boolean }> }>;
      }>();
      const reviewPrSkill = content.skills.find((s) => s.id === 'review-pr');

      // github_get_pr and github_add_comment should be available
      const githubGetPr = reviewPrSkill!.tools.find((t) => t.name === 'github_get_pr');
      const githubAddComment = reviewPrSkill!.tools.find((t) => t.name === 'github_add_comment');

      expect(githubGetPr?.available).toBe(true);
      expect(githubAddComment?.available).toBe(true);
    });

    test('should mark missing tools correctly', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'deploy-app',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{
        skills: Array<{ id: string; tools: Array<{ name: string; available: boolean }> }>;
      }>();
      const deploySkill = content.skills.find((s) => s.id === 'deploy-app');

      // docker_build, docker_push, k8s_apply are not registered, should be unavailable
      const dockerBuild = deploySkill!.tools.find((t) => t.name === 'docker_build');
      const k8sApply = deploySkill!.tools.find((t) => t.name === 'k8s_apply');

      expect(dockerBuild?.available).toBe(false);
      expect(k8sApply?.available).toBe(false);
    });
  });

  test.describe('Skill Metadata', () => {
    test('should return complete skill metadata', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'review-pr',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{
        skills: Array<{ id: string; name: string; description: string; source: string }>;
      }>();
      const reviewPrSkill = content.skills.find((s) => s.id === 'review-pr');

      expect(reviewPrSkill!.id).toBe('review-pr');
      expect(reviewPrSkill!.name).toBe('review-pr');
      expect(reviewPrSkill!.description).toBeDefined();
      expect(reviewPrSkill!.source).toBe('local');
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list searchSkills tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('searchSkills');
    });
  });

  test.describe('Empty Results', () => {
    test('should return empty array for non-matching query', async ({ mcp }) => {
      const result = await mcp.tools.call('searchSkills', {
        query: 'nonexistent-workflow-xyz-12345',
      });

      expect(result).toBeSuccessful();

      const content = result.json<{ skills: unknown[]; total: number }>();
      expect(content.skills).toBeDefined();
      expect(content.total).toBeDefined();
    });
  });
});
