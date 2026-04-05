/**
 * E2E Tests for Environment Awareness (availableWhen)
 *
 * Validates that tools, resources, and prompts with `availableWhen` constraints
 * are correctly filtered from discovery and blocked from execution when the
 * constraint does not match the current environment.
 *
 * Test environment: Node.js, standalone deployment, current OS platform.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Environment Awareness E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-env-awareness/src/main.ts',
    project: 'demo-e2e-env-awareness',
    publicMode: true,
  });

  // ================================================================
  // Tool Discovery Filtering
  // ================================================================

  test.describe('Tool Discovery Filtering', () => {
    test('should list tools with no constraint or matching constraints', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      // Always available (no constraint)
      expect(names).toContain('always_available');

      // Matches current platform
      expect(names).toContain('current_platform_tool');

      // Matches Node.js runtime
      expect(names).toContain('node_runtime_tool');

      // Matches standalone deployment
      expect(names).toContain('standalone_deploy_tool');

      // All constraints match (platform + runtime + deployment)
      expect(names).toContain('multi_constraint_tool');
    });

    test('should NOT list tools with non-matching platform', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      expect(names).not.toContain('impossible_platform_tool');
    });

    test('should NOT list tools with non-matching runtime', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      expect(names).not.toContain('browser_only_tool');
    });

    test('should NOT list tools with non-matching deployment', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      expect(names).not.toContain('serverless_only_tool');
    });

    test('should NOT list tools where one AND-ed constraint fails', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      // Platform matches but runtime is 'browser' — AND fails
      expect(names).not.toContain('multi_constraint_fail_tool');
    });

    test('should NOT list hidden tools even if availableWhen matches', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      // hideFromDiscovery=true, availableWhen matches — hidden from listing
      expect(names).not.toContain('hidden_but_available');
    });
  });

  // ================================================================
  // Tool Execution (including hidden tool invocation)
  // ================================================================

  test.describe('Tool Execution', () => {
    test('should execute a tool with matching availableWhen', async ({ mcp }) => {
      const result = await mcp.tools.call('always_available', { name: 'E2E' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('E2E');
    });

    test('should execute a tool constrained to current platform', async ({ mcp }) => {
      const result = await mcp.tools.call('current_platform_tool', { msg: 'hello' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent(process.platform);
    });

    test('should execute hidden tool that matches availableWhen (soft hide, not hard block)', async ({ mcp }) => {
      // hideFromDiscovery is a soft hide — tool should still be callable directly
      const result = await mcp.tools.call('hidden_but_available', { msg: 'secret' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('hidden but available');
    });

    test('should execute a tool with multiple matching constraints', async ({ mcp }) => {
      const result = await mcp.tools.call('multi_constraint_tool', { msg: 'hello' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('multi');
    });

    test('should return error when calling a tool filtered by platform', async ({ mcp }) => {
      const result = await mcp.tools.call('impossible_platform_tool', { msg: 'hello' });

      expect(result).toBeError();
    });

    test('should return error when calling a tool filtered by runtime', async ({ mcp }) => {
      const result = await mcp.tools.call('browser_only_tool', { msg: 'hello' });

      expect(result).toBeError();
    });

    test('should return error when calling a tool filtered by deployment', async ({ mcp }) => {
      const result = await mcp.tools.call('serverless_only_tool', { msg: 'hello' });

      expect(result).toBeError();
    });

    test('should return error when calling a tool where AND constraint fails', async ({ mcp }) => {
      const result = await mcp.tools.call('multi_constraint_fail_tool', { msg: 'hello' });

      expect(result).toBeError();
    });
  });

  // ================================================================
  // Resource Discovery Filtering
  // ================================================================

  test.describe('Resource Discovery Filtering', () => {
    test('should list resources with matching runtime constraint', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      const names = resources.map((r) => r.name);

      // Node.js runtime matches
      expect(names).toContain('node-info');
    });

    test('should NOT list resources with non-matching runtime', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      const names = resources.map((r) => r.name);

      // Browser runtime does not match
      expect(names).not.toContain('browser-storage');
    });

    test('should read a resource with matching constraint', async ({ mcp }) => {
      const result = await mcp.resources.read('env://node-info');

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('node');
    });
  });

  // ================================================================
  // Prompt Discovery Filtering
  // ================================================================

  test.describe('Prompt Discovery Filtering', () => {
    test('should list prompts with matching runtime constraint', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      const names = prompts.map((p) => p.name);

      expect(names).toContain('node-debug');
    });

    test('should NOT list prompts with non-matching runtime', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      const names = prompts.map((p) => p.name);

      expect(names).not.toContain('edge-prompt');
    });

    test('should get a prompt with matching constraint', async ({ mcp }) => {
      const result = await mcp.prompts.get('node-debug', { topic: 'memory' });

      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  // ================================================================
  // NODE_ENV Filtering (default: test)
  // ================================================================

  test.describe('NODE_ENV Filtering (env=test)', () => {
    test('should list tool with env: ["test"] when NODE_ENV=test', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      expect(names).toContain('test_env_only_tool');
    });

    test('should NOT list tool with env: ["production"] when NODE_ENV=test', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      expect(names).not.toContain('production_only_tool');
    });

    test('should NOT list tool with env: ["development"] when NODE_ENV=test', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const names = tools.map((t) => t.name);

      expect(names).not.toContain('development_only_tool');
    });

    test('should execute tool matching current NODE_ENV', async ({ mcp }) => {
      const result = await mcp.tools.call('test_env_only_tool', { msg: 'hi' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('test-env');
    });

    test('should return error when calling tool filtered by NODE_ENV', async ({ mcp }) => {
      const result = await mcp.tools.call('production_only_tool', { msg: 'hi' });

      expect(result).toBeError();
    });
  });
});
