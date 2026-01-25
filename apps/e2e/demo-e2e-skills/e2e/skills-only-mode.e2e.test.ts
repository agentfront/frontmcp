/**
 * E2E Tests for MCP Skills-Only Mode
 *
 * Tests the `?mode=skills_only` query parameter for MCP connections:
 * - tools/list returns empty array (tools hidden from discovery)
 * - skills/search and skills/load work normally
 * - Tool execution still works (not blocked, just hidden)
 *
 * This mode is useful for planner agents that:
 * - Fetch skills to create execution plans
 * - Delegate tool execution to sub-agents
 */
import { test, expect } from '@frontmcp/testing';

interface LoadSkillResult {
  skill: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    tools: Array<{ name: string; available: boolean }>;
  };
  availableTools: string[];
  missingTools: string[];
  isComplete: boolean;
  formattedContent: string;
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

    test('should list searchSkills and loadSkill tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('searchSkills');
      expect(tools).toContainTool('loadSkill');
    });
  });

  // TODO: Skills-only mode requires transport-level implementation
  // See plan: MCP connections with ?mode=skills_only should hide tools from discovery
  test.describe.skip('Skills-Only Mode', () => {
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

    test('should still allow searchSkills in skills-only mode', async ({ server }) => {
      const builder = server.createClientBuilder();
      const client = await builder
        .withTransport('streamable-http')
        .withQueryParams({ mode: 'skills_only' })
        .buildAndConnect();

      try {
        // searchSkills should work even though tools aren't listed
        const result = await client.tools.call('searchSkills', {
          query: 'review',
        });

        expect(result).toBeSuccessful();

        const content = result.json<{ skills: Array<{ id: string }> }>();
        expect(content.skills).toBeDefined();
        expect(content.skills.length).toBeGreaterThan(0);
        expect(content.skills.map((s) => s.id)).toContain('review-pr');
      } finally {
        await client.disconnect();
      }
    });

    test('should still allow loadSkill in skills-only mode', async ({ server }) => {
      const builder = server.createClientBuilder();
      const client = await builder
        .withTransport('streamable-http')
        .withQueryParams({ mode: 'skills_only' })
        .buildAndConnect();

      try {
        const result = await client.tools.call('loadSkill', {
          skillId: 'review-pr',
        });

        expect(result).toBeSuccessful();

        const content = result.json<LoadSkillResult>();
        expect(content.skill).toBeDefined();
        expect(content.skill.id).toBe('review-pr');
        expect(content.formattedContent).toBeDefined();
      } finally {
        await client.disconnect();
      }
    });

    test('should still allow tool execution in skills-only mode', async ({ server }) => {
      const builder = server.createClientBuilder();
      const client = await builder
        .withTransport('streamable-http')
        .withQueryParams({ mode: 'skills_only' })
        .buildAndConnect();

      try {
        // Even though tools aren't listed, they can still be executed
        // (the planner delegated the tool name to a sub-agent which knows it)
        const result = await client.tools.call('github_get_pr', {
          pr_url: 'https://github.com/owner/repo/pull/123',
        });

        expect(result).toBeSuccessful();
      } finally {
        await client.disconnect();
      }
    });
  });

  // Note: SSE transport tests are skipped because SSE transport is not yet implemented
  // in the test client. Uncomment these tests when SSE transport is available.
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
        const result = await client.tools.call('searchSkills', {
          query: 'deploy',
        });

        expect(result).toBeSuccessful();

        const content = result.json<{ skills: Array<{ id: string }> }>();
        expect(content.skills).toBeDefined();
      } finally {
        await client.disconnect();
      }
    });
  });

  // TODO: Skills-only mode requires transport-level implementation
  test.describe.skip('Mixed Mode Clients', () => {
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
        const normalSkillSearch = await mcp.tools.call('searchSkills', { query: 'review' });
        const skillsOnlySearch = await skillsOnlyClient.tools.call('searchSkills', { query: 'review' });

        expect(normalSkillSearch).toBeSuccessful();
        expect(skillsOnlySearch).toBeSuccessful();
      } finally {
        await skillsOnlyClient.disconnect();
      }
    });
  });
});
