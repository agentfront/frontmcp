/**
 * E2E Tests for Hook System
 *
 * Tests Will/Did hook patterns:
 * - Will hooks execute before tool
 * - Did hooks execute after tool
 * - Hook priority ordering
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Hooks E2E', () => {
  test.use({
    server: './src/main.ts',
    publicMode: true,
  });

  test.describe('Hook Execution', () => {
    test.beforeEach(async ({ mcp }) => {
      // Clear audit log before each test
      await mcp.tools.call('clear-audit-log', {});
    });

    test('should execute will hooks before tool execution', async ({ mcp }) => {
      // Call the audited tool
      await mcp.tools.call('audited-tool', { message: 'test message' });

      // Get the audit log
      const result = await mcp.tools.call('get-audit-log', { toolName: 'audited-tool' });

      expect(result).toBeSuccessful();

      const content = JSON.stringify(result);
      // Should have will entries
      expect(content).toContain('"hookType":"will"');
    });

    test('should execute did hooks after tool execution', async ({ mcp }) => {
      await mcp.tools.call('audited-tool', { message: 'test message' });

      const result = await mcp.tools.call('get-audit-log', { toolName: 'audited-tool' });

      expect(result).toBeSuccessful();

      const content = JSON.stringify(result);
      // Should have did entries
      expect(content).toContain('"hookType":"did"');
    });

    test('should execute hooks in priority order', async ({ mcp }) => {
      await mcp.tools.call('audited-tool', { message: 'test' });

      const result = await mcp.tools.call('get-audit-log', {});

      expect(result).toBeSuccessful();

      const content = JSON.stringify(result);

      // Check execution order array contains expected patterns
      // Will hooks: high priority (100) runs before low priority (50)
      // Did hooks: high priority (100) runs before low priority (50)
      expect(content).toContain('will:execute:100');
      expect(content).toContain('will:execute:50');
      expect(content).toContain('did:execute:100');
      expect(content).toContain('did:execute:50');
    });

    test('should track execution order correctly', async ({ mcp }) => {
      await mcp.tools.call('audited-tool', { message: 'first' });
      await mcp.tools.call('audited-tool', { message: 'second' });

      const result = await mcp.tools.call('get-audit-log', {});

      expect(result).toBeSuccessful();

      const content = JSON.stringify(result);

      // Should have stats showing multiple executions
      // 2 tool calls x 4 hooks each = 8 total entries
      expect(content).toContain('"total":8');
      expect(content).toContain('"willCount":4');
      expect(content).toContain('"didCount":4');
    });

    test('should capture duration in did hooks', async ({ mcp }) => {
      await mcp.tools.call('audited-tool', {
        message: 'delayed',
        delay: 50, // Small delay to ensure measurable duration
      });

      const result = await mcp.tools.call('get-audit-log', { toolName: 'audited-tool' });

      expect(result).toBeSuccessful();

      const content = JSON.stringify(result);
      // Should have durationMs field in did hooks
      expect(content).toContain('durationMs');
    });
  });

  test.describe('Resource Access', () => {
    test.beforeEach(async ({ mcp }) => {
      await mcp.tools.call('clear-audit-log', {});
    });

    test('should list audit log resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('audit://log');
    });

    test('should read audit log from resource', async ({ mcp }) => {
      // Generate some audit entries
      await mcp.tools.call('audited-tool', { message: 'resource test' });

      const content = await mcp.resources.read('audit://log');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('entries');
      expect(content).toHaveTextContent('stats');
    });
  });

  test.describe('Prompt Access', () => {
    test('should list audit-summary prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('audit-summary');
    });

    test('should generate audit summary', async ({ mcp }) => {
      // Generate some audit entries
      await mcp.tools.call('audited-tool', { message: 'summary test' });

      const result = await mcp.prompts.get('audit-summary', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('Audit Log Summary');
        expect(message.content.text).toContain('Hook Execution Order');
      }
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list all hook demo tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('audited-tool');
      expect(tools).toContainTool('get-audit-log');
      expect(tools).toContainTool('clear-audit-log');
    });
  });
});
