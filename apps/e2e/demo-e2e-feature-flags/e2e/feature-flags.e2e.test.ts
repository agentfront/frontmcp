/**
 * E2E Tests for FeatureFlagPlugin
 *
 * Tests feature flag-based capability filtering:
 * - Tools with enabled flags appear in tools/list
 * - Tools with disabled flags are hidden from tools/list
 * - Tools without flags always appear
 * - Object-style featureFlag refs with defaultValue work
 * - Direct tool/call is blocked when flag is disabled (execution gate)
 * - Programmatic flag checks via this.featureFlags work
 * - Resources with flags are filtered
 * - Prompts with flags are filtered
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Feature Flags E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-feature-flags/src/main.ts',
    project: 'demo-e2e-feature-flags',
    publicMode: true,
  });

  // ─────────────────────────────────────────────────────────────────────
  // Tool Discovery (List Filtering)
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Tool Discovery', () => {
    test('should show tools with enabled feature flags', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // beta-search flag is enabled → tool should be visible
      expect(tools).toContainTool('beta-search');

      // always-on flag is enabled → tool should be visible
      expect(tools).toContainTool('always-enabled');
    });

    test('should hide tools with disabled feature flags', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // experimental-agent flag is disabled → tool should NOT be visible
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).not.toContain('experimental-agent');
    });

    test('should always show unflagged tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // unflagged tool has no featureFlag → always visible
      expect(tools).toContainTool('unflagged');

      // check-flag tool has no featureFlag → always visible
      expect(tools).toContainTool('check-flag');
    });

    test('should show tools with object-style featureFlag and defaultValue: true', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // default-true has featureFlag: { key: 'nonexistent-flag', defaultValue: true }
      // Since 'nonexistent-flag' evaluates to false in static adapter,
      // but defaultValue controls the fallback behavior
      // Note: The static adapter returns false for unknown flags,
      // so this tool should be hidden (defaultValue only applies in accessor, not adapter)
      const toolNames = tools.map((t: any) => t.name);
      // The list hook uses adapter.evaluateFlags which returns false for unknown flags
      // Then falls back to ref.defaultValue which is true
      expect(toolNames).toContain('default-true');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Tool Execution (Enabled Flags)
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Enabled Flag Tool Execution', () => {
    test('should execute tool with enabled flag successfully', async ({ mcp }) => {
      const result = await mcp.tools.call('beta-search', { query: 'hello' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('hello');
      expect(result).toHaveTextContent('beta-search');
    });

    test('should execute always-enabled tool successfully', async ({ mcp }) => {
      const result = await mcp.tools.call('always-enabled', { message: 'test' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('always-enabled');
      expect(result).toHaveTextContent('always-on');
    });

    test('should execute unflagged tool successfully', async ({ mcp }) => {
      const result = await mcp.tools.call('unflagged', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('always available');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Execution Gate (Disabled Flags)
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Execution Gate', () => {
    test('should block direct tool/call for tool with disabled flag', async ({ mcp }) => {
      // experimental-agent has flag 'experimental-agent' which is disabled
      // Direct tool/call should be blocked by the execution gate hook
      const result = await mcp.tools.call('experimental-agent', { task: 'test' });

      // The execution gate should throw, resulting in an error response
      expect(result).toBeError();
      expect(result).toHaveTextContent('disabled by feature flag');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Programmatic Flag Checks (this.featureFlags)
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Programmatic Flag Checks', () => {
    test('should check enabled flag programmatically', async ({ mcp }) => {
      const result = await mcp.tools.call('check-flag', { flagKey: 'beta-search' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"isEnabled":true');
    });

    test('should check disabled flag programmatically', async ({ mcp }) => {
      const result = await mcp.tools.call('check-flag', { flagKey: 'experimental-agent' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"isEnabled":false');
    });

    test('should return false for unknown flags', async ({ mcp }) => {
      const result = await mcp.tools.call('check-flag', { flagKey: 'nonexistent' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"isEnabled":false');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Resource Filtering
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Resource Filtering', () => {
    test('should show resources with enabled feature flags', async ({ mcp }) => {
      const resources = await mcp.resources.list();

      // flag-for-resource is enabled → resource should be visible
      expect(resources).toContainResource('flags://status');
    });

    test('should read resource gated behind enabled flag', async ({ mcp }) => {
      const content = await mcp.resources.read('flags://status');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('accessible');
      expect(content).toHaveTextContent('flag-for-resource');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Prompt Filtering
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Prompt Filtering', () => {
    test('should hide prompts with disabled feature flags', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();

      // flag-for-prompt is disabled → prompt should NOT be visible
      const promptNames = prompts.map((p: any) => p.name);
      expect(promptNames).not.toContain('flag-report');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Combined Discovery Test
  // ─────────────────────────────────────────────────────────────────────

  test.describe('Combined Discovery', () => {
    test('should correctly filter all capability types in a single session', async ({ mcp }) => {
      // Tools
      const tools = await mcp.tools.list();
      const toolNames = tools.map((t: any) => t.name);

      // Enabled flags → visible
      expect(toolNames).toContain('beta-search');
      expect(toolNames).toContain('always-enabled');
      expect(toolNames).toContain('unflagged');
      expect(toolNames).toContain('check-flag');

      // Disabled flags → hidden
      expect(toolNames).not.toContain('experimental-agent');

      // Resources
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('flags://status');

      // Prompts
      const prompts = await mcp.prompts.list();
      const promptNames = prompts.map((p: any) => p.name);
      expect(promptNames).not.toContain('flag-report');
    });
  });
});
