/**
 * E2E Tests for Transport Recreation
 *
 * Tests session continuity and state preservation across:
 * - Multiple tool calls within the same session
 * - Session ID consistency
 * - Counter state persistence
 *
 * Note: Full cold-start and multi-instance failover scenarios are tested
 * at the unit level in transport.registry.test.ts and the transport adapter tests.
 * These E2E tests verify the end-to-end session behavior at the MCP protocol level.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Transport Recreation E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-transport-recreation/src/main.ts',
    publicMode: true,
  });

  test.describe('Session State Continuity', () => {
    test('should return session info with session ID', async ({ mcp }) => {
      const result = await mcp.tools.call('get-session-info', {});
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('sessionId');
      expect(result).toHaveTextContent('hasSession');
      expect(result).toHaveTextContent('requestCount');
    });

    test('should increment request count across calls', async ({ mcp }) => {
      // First call
      const result1 = await mcp.tools.call('get-session-info', {});
      expect(result1).toBeSuccessful();
      expect(result1).toHaveTextContent('requestCount');

      // Second call - count should be different (higher)
      const result2 = await mcp.tools.call('get-session-info', {});
      expect(result2).toBeSuccessful();
      expect(result2).toHaveTextContent('requestCount');
    });
  });

  test.describe('Counter State Persistence', () => {
    test('should increment counter and return new value', async ({ mcp }) => {
      const result = await mcp.tools.call('increment-counter', { amount: 5 });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('newValue');
      expect(result).toHaveTextContent('previousValue');
      expect(result).toHaveTextContent('incrementedBy');
    });

    test('should preserve counter state across multiple increments', async ({ mcp }) => {
      // First increment
      const result1 = await mcp.tools.call('increment-counter', { amount: 3 });
      expect(result1).toBeSuccessful();
      expect(result1).toHaveTextContent('3'); // newValue contains 3

      // Second increment - should build on previous
      const result2 = await mcp.tools.call('increment-counter', { amount: 2 });
      expect(result2).toBeSuccessful();
      expect(result2).toHaveTextContent('5'); // newValue contains 5
    });
  });

  test.describe('Session Consistency', () => {
    test('should return consistent session ID across tools', async ({ mcp }) => {
      // Both tools should report the same session
      const sessionResult = await mcp.tools.call('get-session-info', {});
      expect(sessionResult).toBeSuccessful();
      expect(sessionResult).toHaveTextContent('sessionId');

      const counterResult = await mcp.tools.call('increment-counter', { amount: 1 });
      expect(counterResult).toBeSuccessful();
      expect(counterResult).toHaveTextContent('sessionId');
    });

    test('should maintain state within session', async ({ mcp }) => {
      // Increment counter
      await mcp.tools.call('increment-counter', { amount: 10 });

      // Increment again - should show previous value was 10
      const result = await mcp.tools.call('increment-counter', { amount: 5 });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"previousValue":10');
    });
  });

  test.describe('Input Validation', () => {
    test('should accept valid increment amount', async ({ mcp }) => {
      const result = await mcp.tools.call('increment-counter', { amount: 10 });
      expect(result).toBeSuccessful();
    });

    test('should reject invalid increment amount (negative)', async ({ mcp }) => {
      const result = await mcp.tools.call('increment-counter', { amount: -1 });
      expect(result).toBeError();
    });

    test('should reject invalid increment amount (zero)', async ({ mcp }) => {
      const result = await mcp.tools.call('increment-counter', { amount: 0 });
      expect(result).toBeError();
    });

    test('should use default increment amount when not provided', async ({ mcp }) => {
      const result = await mcp.tools.call('increment-counter', {});
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"incrementedBy":1');
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list transport test tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('get-session-info');
      expect(tools).toContainTool('increment-counter');
    });
  });
});
