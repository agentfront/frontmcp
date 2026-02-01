/**
 * E2E Tests for Notification System
 *
 * Tests MCP notification functionality:
 * - Resource change notifications
 * - Progress notifications
 * - Long-running task with progress updates
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Notification System E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-notifications/src/main.ts',
    project: 'demo-e2e-notifications',
    publicMode: true,
  });

  test.describe('Resource Change Notifications', () => {
    test('should trigger resource list changed notification', async ({ mcp }) => {
      const result = await mcp.tools.call('trigger-resource-change', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Resource change notification sent');
      expect(result).toHaveTextContent('logId');
    });

    test('should trigger resource change with specific URI', async ({ mcp }) => {
      const result = await mcp.tools.call('trigger-resource-change', {
        uri: 'notifications://test-resource',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('notifications://test-resource');
    });
  });

  test.describe('Progress Notifications', () => {
    test('should send progress notification with info level', async ({ mcp }) => {
      const result = await mcp.tools.call('trigger-progress', {
        level: 'info',
        message: 'Processing data...',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Progress notification sent');
    });

    test('should send progress notification with warning level', async ({ mcp }) => {
      const result = await mcp.tools.call('trigger-progress', {
        level: 'warning',
        message: 'Memory usage high',
        data: { memoryUsage: '85%' },
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Memory usage high');
    });

    test('should send progress notification with additional data', async ({ mcp }) => {
      const result = await mcp.tools.call('trigger-progress', {
        level: 'debug',
        message: 'Debug info',
        data: { counter: 42, status: 'active' },
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Debug info');
    });
  });

  test.describe('Long Running Task', () => {
    test('should complete long running task with progress updates', async ({ mcp }) => {
      const result = await mcp.tools.call('long-running-task', {
        steps: 3,
        delayMs: 50,
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('success');
      expect(result).toHaveTextContent('totalSteps');
      expect(result).toHaveTextContent('progressLogs');
    });

    test('should handle single step task', async ({ mcp }) => {
      const result = await mcp.tools.call('long-running-task', {
        steps: 1,
        delayMs: 10,
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('1');
    });

    test('should log progress for each step', async ({ mcp }) => {
      const result = await mcp.tools.call('long-running-task', {
        steps: 5,
        delayMs: 20,
      });

      expect(result).toBeSuccessful();
      // Should have progress logs for all steps
      expect(result).toHaveTextContent('100% complete');
    });
  });

  test.describe('Notification Log Resource', () => {
    test('should list notification log resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('notifications://log');
    });

    test('should read notification log after triggering notifications', async ({ mcp }) => {
      // First trigger some notifications
      await mcp.tools.call('trigger-resource-change', { uri: 'test://resource' });
      await mcp.tools.call('trigger-progress', { level: 'info', message: 'Test message' });

      // Then read the log
      const content = await mcp.resources.read('notifications://log');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('notifications');
      expect(content).toHaveTextContent('count');
    });

    test('should show notification types in log', async ({ mcp }) => {
      // Trigger different types of notifications
      await mcp.tools.call('trigger-resource-change', {});
      await mcp.tools.call('trigger-progress', { level: 'info', message: 'Progress 1' });
      await mcp.tools.call('long-running-task', { steps: 2, delayMs: 10 });

      const content = await mcp.resources.read('notifications://log');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('types');
    });
  });

  test.describe('Notification Summary Prompt', () => {
    test('should list notification-summary prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('notification-summary');
    });

    test('should generate summary with no notifications', async ({ mcp }) => {
      const result = await mcp.prompts.get('notification-summary', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('Notification Summary');
      }
    });

    test('should generate summary after notifications', async ({ mcp }) => {
      // Generate some notifications
      await mcp.tools.call('trigger-resource-change', {});
      await mcp.tools.call('trigger-progress', { level: 'info', message: 'Test' });

      const result = await mcp.prompts.get('notification-summary', { type: 'all' });

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);
    });

    test('should filter summary by progress type', async ({ mcp }) => {
      // Generate notifications
      await mcp.tools.call('trigger-progress', { level: 'info', message: 'Test 1' });
      await mcp.tools.call('trigger-progress', { level: 'warning', message: 'Test 2' });

      const result = await mcp.prompts.get('notification-summary', { type: 'progress' });

      expect(result).toBeSuccessful();
      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('progress');
      }
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list all notification demo tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('trigger-resource-change');
      expect(tools).toContainTool('trigger-progress');
      expect(tools).toContainTool('long-running-task');
    });
  });
});
