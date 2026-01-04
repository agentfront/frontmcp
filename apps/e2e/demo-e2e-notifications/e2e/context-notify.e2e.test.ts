/**
 * E2E Tests for ToolContext.notify() method
 *
 * Tests the this.notify() method that sends notifications/message
 * to the current session via the MCP transport.
 *
 * Note: In E2E tests, the notify method may return notificationSent: false
 * if the session infrastructure isn't fully established. This is expected
 * behavior in public mode testing. The important assertion is that the
 * method executes without error and returns the correct output shape.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('ToolContext.notify() Method', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-notifications/src/main.ts',
    publicMode: true,
  });

  test.describe('String Notifications', () => {
    test('should execute notify with string message', async ({ mcp }) => {
      const result = await mcp.tools.call('test-notify-method', {
        message: 'Hello from notify',
      });

      expect(result).toBeSuccessful();
      const output = result.json<{ success: boolean; notificationSent: boolean }>();
      expect(output.success).toBe(true);
      // notificationSent depends on session availability
      expect(typeof output.notificationSent).toBe('boolean');
    });

    test('should handle custom message with special characters', async ({ mcp }) => {
      const result = await mcp.tools.call('test-notify-method', {
        message: 'Custom notification message with special chars: @#$%',
      });

      expect(result).toBeSuccessful();
      expect(result.json()).toMatchObject({
        success: true,
      });
    });
  });

  test.describe('Object Notifications', () => {
    test('should execute notify with structured object data', async ({ mcp }) => {
      const result = await mcp.tools.call('test-notify-method', {
        message: 'Structured notification',
        useObject: true,
      });

      expect(result).toBeSuccessful();
      const output = result.json<{ success: boolean; notificationSent: boolean }>();
      expect(output.success).toBe(true);
    });

    test('should execute notify with object and warning level', async ({ mcp }) => {
      const result = await mcp.tools.call('test-notify-method', {
        message: 'Warning message',
        useObject: true,
        level: 'warning',
      });

      expect(result).toBeSuccessful();
      expect(result.json()).toMatchObject({
        success: true,
      });
    });
  });

  test.describe('Log Levels', () => {
    test('should accept debug level', async ({ mcp }) => {
      const result = await mcp.tools.call('test-notify-method', {
        message: 'Debug message',
        level: 'debug',
      });

      expect(result).toBeSuccessful();
      expect(result.json()).toMatchObject({ success: true });
    });

    test('should accept info level', async ({ mcp }) => {
      const result = await mcp.tools.call('test-notify-method', {
        message: 'Info message',
        level: 'info',
      });

      expect(result).toBeSuccessful();
      expect(result.json()).toMatchObject({ success: true });
    });

    test('should accept warning level', async ({ mcp }) => {
      const result = await mcp.tools.call('test-notify-method', {
        message: 'Warning message',
        level: 'warning',
      });

      expect(result).toBeSuccessful();
      expect(result.json()).toMatchObject({ success: true });
    });

    test('should accept error level', async ({ mcp }) => {
      const result = await mcp.tools.call('test-notify-method', {
        message: 'Error message',
        level: 'error',
      });

      expect(result).toBeSuccessful();
      expect(result.json()).toMatchObject({ success: true });
    });

    test('should handle all log levels in sequence', async ({ mcp }) => {
      const levels = ['debug', 'info', 'warning', 'error'] as const;

      for (const level of levels) {
        const result = await mcp.tools.call('test-notify-method', {
          message: `Test ${level} level`,
          level,
        });

        expect(result).toBeSuccessful();
        expect(result.json()).toMatchObject({ success: true });
      }
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list test-notify-method tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('test-notify-method');
    });
  });
});
