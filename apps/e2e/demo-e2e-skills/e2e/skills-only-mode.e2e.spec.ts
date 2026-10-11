/**
 * E2E Tests for MCP Skills-Only Mode
 *
 * Tests the `?mode=skills_only` query parameter for MCP connections:
 * - tools/list returns an empty array
 * - tools/call is answered as for an unknown tool (`Tool "<name>" not found`)
 * - skills/search and skills/load work normally
 *
 * This mode is useful for planner agents that:
 * - Fetch skills to create execution plans
 * - Delegate tool execution to sub-agents, which connect without the mode
 */
import { expect, test } from '@frontmcp/testing';

import { loadSkills, searchSkills } from './helpers/skills-protocol';

interface SkillResult {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: Array<{ name: string; available: boolean }>;
  availableTools: string[];
  missingTools: string[];
  isComplete: boolean;
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

test.describe('MCP Skills-Only Mode E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  test.describe('Normal Mode (default)', () => {
    test('should list tools normally', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Should have tools listed
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toContainTool('github_get_pr');
      expect(tools).toContainTool('github_add_comment');
      expect(tools).toContainTool('slack_notify');
    });

    test('should expose SEP-2640 skill:// resource templates', async ({ mcp }) => {
      const templates = await mcp.resources.listTemplates();
      const uris = templates.map((t: { uriTemplate: string }) => t.uriTemplate);
      expect(uris).toContain('skill://{+skillPath}/SKILL.md');
    });
  });

  test.describe('Skills-Only Mode', () => {
    test('should return empty tools list in skills-only mode', async ({ server }) => {
      // Create a client that connects with skills_only mode
      const builder = server.createClientBuilder();
      const client = await builder
        .withTransport('streamable-http')
        .withQueryParams({ mode: 'skills_only' })
        .buildAndConnect();

      try {
        const tools = await client.tools.list();

        // In skills-only mode, tools/list should return empty array
        expect(tools.length).toBe(0);
      } finally {
        await client.disconnect();
      }
    });

    test('should still allow skills/search in skills-only mode', async ({ server }) => {
      const builder = server.createClientBuilder();
      const client = await builder
        .withTransport('streamable-http')
        .withQueryParams({ mode: 'skills_only' })
        .buildAndConnect();

      try {
        // skills/search should work even though tools aren't listed
        const result = await searchSkills(client, {
          query: 'review',
        });

        expect(result).toBeDefined();

        const content = result as { skills: Array<{ id: string }> };
        expect(content.skills).toBeDefined();
        expect(content.skills.length).toBeGreaterThan(0);
        expect(content.skills.map((s) => s.id)).toContain('review-pr');
      } finally {
        await client.disconnect();
      }
    });

    test('should still allow skills/load in skills-only mode', async ({ server }) => {
      const builder = server.createClientBuilder();
      const client = await builder
        .withTransport('streamable-http')
        .withQueryParams({ mode: 'skills_only' })
        .buildAndConnect();

      try {
        const result = await loadSkills(client, {
          skillIds: ['review-pr'],
        });

        expect(result).toBeDefined();

        const content = result as LoadSkillsResult;
        expect(content.skills).toBeDefined();
        expect(content.skills.length).toBe(1);
        expect(content.skills[0].id).toBe('review-pr');
        expect(content.skills[0].formattedContent).toBeDefined();
      } finally {
        await client.disconnect();
      }
    });

    test('should refuse tool execution in skills-only mode', async ({ server }) => {
      const builder = server.createClientBuilder();
      const client = await builder
        .withTransport('streamable-http')
        .withQueryParams({ mode: 'skills_only' })
        .buildAndConnect();

      try {
        const result = await client.tools.call('github_get_pr', {
          pr_url: 'https://github.com/owner/repo/pull/123',
        });

        expect(result).toBeError();
        expect(result).toHaveTextContent('Tool "github_get_pr" not found');
      } finally {
        await client.disconnect();
      }
    });
  });

  // Skipped: the test client has no SSE transport yet. Legacy SSE sessions are covered by
  // libs/sdk/src/skill/__tests__/skills-only-mode.spec.ts.
  test.describe.skip('SSE Transport with Skills-Only Mode', () => {
    test('should return empty tools list via SSE in skills-only mode', async ({ server }) => {
      const builder = server.createClientBuilder();
      const client = await builder.withTransport('sse').withQueryParams({ mode: 'skills_only' }).buildAndConnect();

      try {
        const tools = await client.tools.list();
        expect(tools.length).toBe(0);
      } finally {
        await client.disconnect();
      }
    });

    test('should allow skill operations via SSE in skills-only mode', async ({ server }) => {
      const builder = server.createClientBuilder();
      const client = await builder.withTransport('sse').withQueryParams({ mode: 'skills_only' }).buildAndConnect();

      try {
        const result = await searchSkills(client, {
          query: 'deploy',
        });

        expect(result).toBeDefined();

        const content = result as { skills: Array<{ id: string }> };
        expect(content.skills).toBeDefined();
      } finally {
        await client.disconnect();
      }
    });
  });

  test.describe('Mixed Mode Clients', () => {
    test('normal client and skills-only client can coexist', async ({ mcp, server }) => {
      // Normal client should see tools
      const normalTools = await mcp.tools.list();
      expect(normalTools.length).toBeGreaterThan(0);
      expect(normalTools).toContainTool('github_get_pr');

      // Skills-only client should not see tools
      const builder = server.createClientBuilder();
      const skillsOnlyClient = await builder
        .withTransport('streamable-http')
        .withQueryParams({ mode: 'skills_only' })
        .buildAndConnect();

      try {
        const skillsOnlyTools = await skillsOnlyClient.tools.list();
        expect(skillsOnlyTools.length).toBe(0);

        // Both should be able to search skills
        const normalSkillSearch = await searchSkills(mcp, { query: 'review' });
        const skillsOnlySearch = await searchSkills(skillsOnlyClient, { query: 'review' });

        expect(normalSkillSearch).toBeDefined();
        expect(skillsOnlySearch).toBeDefined();
      } finally {
        await skillsOnlyClient.disconnect();
      }
    });
  });
});
