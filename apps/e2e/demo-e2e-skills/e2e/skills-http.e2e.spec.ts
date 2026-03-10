/**
 * E2E Tests for Skills HTTP Endpoints
 *
 * Tests HTTP endpoints for skill discovery:
 * - /llm.txt - Compact skill summaries (plain text)
 * - /llm_full.txt - Full skills with instructions and tool schemas
 * - /skills - List all skills (JSON API)
 * - /skills/{id} - Get specific skill by ID
 * - Visibility filtering (mcp-only, http-only, both)
 */
import { test, expect } from '@frontmcp/testing';

interface SkillApiResponse {
  id: string;
  name: string;
  description: string;
  tags: string[];
  tools: string[];
  parameters?: Array<{
    name: string;
    description?: string;
    required: boolean;
    type: string;
  }>;
  priority: number;
  visibility: 'mcp' | 'http' | 'both';
  availableTools?: string[];
  missingTools?: string[];
  isComplete?: boolean;
}

interface SkillsListResponse {
  skills: SkillApiResponse[];
  total: number;
}

interface SkillDetailResponse extends SkillApiResponse {
  instructions?: string;
  formattedContent?: string;
}

test.describe('Skills HTTP Endpoints E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  // ============================================
  // /llm.txt Endpoint Tests
  // ============================================

  test.describe('GET /llm.txt', () => {
    test('should return compact skill summaries in plain text', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm.txt`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');

      const content = await response.text();
      expect(content).toBeTruthy();

      // Should contain skill headers
      expect(content).toContain('# review-pr');
      expect(content).toContain('# notify-team');
    });

    test('should include skill descriptions', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm.txt`);
      const content = await response.text();

      expect(content).toContain('Review a GitHub pull request');
    });

    test('should include tools for skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm.txt`);
      const content = await response.text();

      expect(content).toContain('Tools:');
      expect(content).toContain('github_get_pr');
    });

    test('should include tags for skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm.txt`);
      const content = await response.text();

      expect(content).toContain('Tags:');
      expect(content).toContain('github');
    });

    test('should NOT include mcp-only skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm.txt`);
      const content = await response.text();

      // mcp-only skill should not appear in HTTP endpoints
      expect(content).not.toContain('# mcp-only-workflow');
    });

    test('should include http-only skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm.txt`);
      const content = await response.text();

      // http-only skill should appear in HTTP endpoints
      expect(content).toContain('# http-only-workflow');
    });

    test('should NOT include hidden skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm.txt`);
      const content = await response.text();

      expect(content).not.toContain('# hidden-internal');
    });

    test('should separate skills with divider', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm.txt`);
      const content = await response.text();

      expect(content).toContain('---');
    });
  });

  // ============================================
  // /llm_full.txt Endpoint Tests
  // ============================================

  test.describe('GET /llm_full.txt', () => {
    test('should return full skill content in plain text', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm_full.txt`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');

      const content = await response.text();
      expect(content).toBeTruthy();
    });

    test('should include skill instructions', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm_full.txt`);
      const content = await response.text();

      // Should contain full instructions from review-pr skill
      expect(content).toContain('## Instructions');
      expect(content).toContain('PR Review Process');
    });

    test('should include tool schemas for available tools', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm_full.txt`);
      const content = await response.text();

      // Should include tool section with schemas
      expect(content).toContain('## Tools');
      expect(content).toContain('**Input Schema:**');
      expect(content).toContain('```json');
    });

    test('should mark tool availability status', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm_full.txt`);
      const content = await response.text();

      // Available tools should be marked with checkmark
      expect(content).toMatch(/\[✓\] github_get_pr/);
    });

    test('should show warnings for missing tools', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm_full.txt`);
      const content = await response.text();

      // Deploy skill has missing tools
      expect(content).toContain('**Warning:**');
      expect(content).toContain('Missing:');
    });

    test('should include parameters section when defined', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm_full.txt`);
      const content = await response.text();

      expect(content).toContain('## Parameters');
      expect(content).toContain('**pr_url** (required)');
    });

    test('should NOT include mcp-only skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm_full.txt`);
      const content = await response.text();

      expect(content).not.toContain('# Skill: mcp-only-workflow');
    });

    test('should include http-only skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/llm_full.txt`);
      const content = await response.text();

      expect(content).toContain('# Skill: http-only-workflow');
    });
  });

  // ============================================
  // /skills API Endpoint Tests
  // ============================================

  test.describe('GET /skills (List)', () => {
    test('should return JSON array of skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const data: SkillsListResponse = await response.json();
      expect(data.skills).toBeDefined();
      expect(Array.isArray(data.skills)).toBe(true);
      expect(data.total).toBeGreaterThan(0);
    });

    test('should include skill metadata in response', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills`);
      const data: SkillsListResponse = await response.json();

      const reviewPr = data.skills.find((s) => s.id === 'review-pr');
      expect(reviewPr).toBeDefined();
      expect(reviewPr!.name).toBe('review-pr');
      expect(reviewPr!.description).toBeTruthy();
      expect(reviewPr!.tags).toContain('github');
      expect(reviewPr!.tools).toContain('github_get_pr');
    });

    test('should include visibility field', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills`);
      const data: SkillsListResponse = await response.json();

      for (const skill of data.skills) {
        expect(['mcp', 'http', 'both']).toContain(skill.visibility);
      }
    });

    test('should NOT include mcp-only skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills`);
      const data: SkillsListResponse = await response.json();

      const mcpOnly = data.skills.find((s) => s.id === 'mcp-only-workflow');
      expect(mcpOnly).toBeUndefined();
    });

    test('should include http-only skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills`);
      const data: SkillsListResponse = await response.json();

      const httpOnly = data.skills.find((s) => s.id === 'http-only-workflow');
      expect(httpOnly).toBeDefined();
      expect(httpOnly!.visibility).toBe('http');
    });

    test('should NOT include hidden skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills`);
      const data: SkillsListResponse = await response.json();

      const hidden = data.skills.find((s) => s.id === 'hidden-internal');
      expect(hidden).toBeUndefined();
    });
  });

  test.describe('GET /skills?query=X (Search)', () => {
    test('should filter skills by query', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills?query=review`);

      expect(response.status).toBe(200);

      const data: SkillsListResponse = await response.json();
      expect(data.skills.length).toBeGreaterThan(0);

      // Should find review-pr skill
      const skillIds = data.skills.map((s) => s.id);
      expect(skillIds).toContain('review-pr');
    });

    test('should filter skills by tags', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills?tags=slack`);

      expect(response.status).toBe(200);

      const data: SkillsListResponse = await response.json();
      // All skills should have the slack tag
      for (const skill of data.skills) {
        expect(skill.tags).toContain('slack');
      }
    });

    test('should filter skills by tools', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills?tools=github_get_pr`);

      expect(response.status).toBe(200);

      const data: SkillsListResponse = await response.json();
      // All skills should use github_get_pr tool
      for (const skill of data.skills) {
        expect(skill.tools).toContain('github_get_pr');
      }
    });

    test('should respect limit parameter', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills?limit=2`);

      expect(response.status).toBe(200);

      const data: SkillsListResponse = await response.json();
      expect(data.skills.length).toBeLessThanOrEqual(2);
    });
  });

  test.describe('GET /skills/{id} (Get Single)', () => {
    test('should return skill details by ID', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills/review-pr`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const data = await response.json();
      // The API wraps the skill in a `skill` property
      expect(data.skill.id).toBe('review-pr');
      expect(data.skill.name).toBe('review-pr');
      expect(data.skill.description).toBeTruthy();
    });

    test('should include tool availability info', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills/review-pr`);
      const data = await response.json();

      expect(data.availableTools).toBeDefined();
      expect(data.missingTools).toBeDefined();
      expect(data.isComplete).toBeDefined();

      // review-pr should be complete (all tools available)
      expect(data.availableTools).toContain('github_get_pr');
      expect(data.isComplete).toBe(true);
    });

    test('should show missing tools for incomplete skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills/deploy-app`);
      const data = await response.json();

      expect(data.missingTools).toBeDefined();
      expect(data.missingTools!.length).toBeGreaterThan(0);
      expect(data.isComplete).toBe(false);
    });

    test('should include formatted content', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills/review-pr`);
      const data = await response.json();

      expect(data.formattedContent).toBeDefined();
      expect(data.formattedContent).toContain('review-pr');
    });

    test('should return 404 for non-existent skill', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills/non-existent-xyz`);

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBeTruthy();
    });

    test('should allow loading hidden skills directly by ID', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills/hidden-internal`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.skill.id).toBe('hidden-internal');
    });

    test('should allow loading http-only skills', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/skills/http-only-workflow`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.skill.id).toBe('http-only-workflow');
    });
  });

  // ============================================
  // Visibility Filtering Tests
  // ============================================

  test.describe('Visibility Filtering', () => {
    test('mcp-only skill should be visible via MCP but not HTTP', async ({ mcp, server }) => {
      // Via MCP - should find the skill
      const mcpResult = await mcp.tools.call('searchSkills', {
        query: 'mcp-only-workflow',
      });
      expect(mcpResult).toBeSuccessful();
      const mcpContent = mcpResult.json<{ skills: Array<{ id: string }> }>();
      const mcpSkillIds = mcpContent.skills.map((s) => s.id);
      expect(mcpSkillIds).toContain('mcp-only-workflow');

      // Via HTTP - should NOT find the skill
      const httpResponse = await fetch(`${server.info.baseUrl}/skills`);
      const httpData: SkillsListResponse = await httpResponse.json();
      const httpSkillIds = httpData.skills.map((s) => s.id);
      expect(httpSkillIds).not.toContain('mcp-only-workflow');
    });

    test('http-only skill should be visible via HTTP but not MCP', async ({ mcp, server }) => {
      // Via HTTP - should find the skill
      const httpResponse = await fetch(`${server.info.baseUrl}/skills`);
      const httpData: SkillsListResponse = await httpResponse.json();
      const httpSkillIds = httpData.skills.map((s) => s.id);
      expect(httpSkillIds).toContain('http-only-workflow');

      // Via MCP - should NOT find the skill
      const mcpResult = await mcp.tools.call('searchSkills', {
        query: 'http-only-workflow',
      });
      expect(mcpResult).toBeSuccessful();
      const mcpContent = mcpResult.json<{ skills: Array<{ id: string }> }>();
      const mcpSkillIds = mcpContent.skills.map((s) => s.id);
      expect(mcpSkillIds).not.toContain('http-only-workflow');
    });

    test('both-visibility skills should be visible everywhere', async ({ mcp, server }) => {
      // Via MCP - should find review-pr
      const mcpResult = await mcp.tools.call('searchSkills', {
        query: 'review-pr',
      });
      expect(mcpResult).toBeSuccessful();
      const mcpContent = mcpResult.json<{ skills: Array<{ id: string }> }>();
      const mcpSkillIds = mcpContent.skills.map((s) => s.id);
      expect(mcpSkillIds).toContain('review-pr');

      // Via HTTP - should also find review-pr
      const httpResponse = await fetch(`${server.info.baseUrl}/skills`);
      const httpData: SkillsListResponse = await httpResponse.json();
      const httpSkillIds = httpData.skills.map((s) => s.id);
      expect(httpSkillIds).toContain('review-pr');
    });
  });
});
