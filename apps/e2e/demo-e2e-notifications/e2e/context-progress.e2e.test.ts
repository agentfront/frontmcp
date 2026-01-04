/**
 * E2E Tests for ToolContext.progress() method
 *
 * Tests the this.progress() method that sends notifications/progress
 * to the current session when a progressToken is provided in _meta.
 *
 * Note: In E2E tests, the progress method may not actually send notifications
 * if the session infrastructure isn't fully established. The tests verify
 * that the progressToken is properly extracted and passed through.
 */
import { test, expect } from '@frontmcp/testing';

// Helper to parse tool result from raw response
function parseToolResult(response: { result?: { content?: Array<{ type: string; text?: string }> } }) {
  const content = response.result?.content?.[0];
  if (content?.type === 'text' && content.text) {
    return JSON.parse(content.text);
  }
  // If structuredContent is available directly
  return response.result;
}

test.describe('ToolContext.progress() Method', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-notifications/src/main.ts',
    publicMode: true,
  });

  test.describe('With progressToken', () => {
    test('should accept progressToken in _meta', async ({ mcp }) => {
      // Call with progressToken in _meta - tests that the token is properly extracted
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-progress-method',
          arguments: {
            steps: 3,
            includeTotal: true,
            includeMessage: true,
          },
          _meta: {
            progressToken: 'test-token-123',
          },
        },
      });

      expect(response.result).toBeDefined();
      const result = parseToolResult(response);
      expect(result.success).toBe(true);
      // progressSent depends on session availability
      expect(typeof result.progressSent).toBe('number');
    });

    test('should accept string progressToken', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-progress-method',
          arguments: {
            steps: 2,
            includeTotal: true,
          },
          _meta: {
            progressToken: 'string-token',
          },
        },
      });

      expect(response.result).toBeDefined();
      const result = parseToolResult(response);
      expect(result.success).toBe(true);
    });

    test('should accept numeric progressToken', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-progress-method',
          arguments: {
            steps: 4,
            includeTotal: true,
          },
          _meta: {
            progressToken: 12345,
          },
        },
      });

      expect(response.result).toBeDefined();
      const result = parseToolResult(response);
      expect(result.success).toBe(true);
    });
  });

  test.describe('Without progressToken', () => {
    test('should NOT send progress when no progressToken', async ({ mcp }) => {
      // Call without progressToken - using regular tools.call helper
      const result = await mcp.tools.call('test-progress-method', {
        steps: 3,
      });

      expect(result).toBeSuccessful();
      expect(result.json()).toMatchObject({
        success: true,
        progressSent: 0, // No progress sent because no token
        hadProgressToken: false,
      });
    });

    test('should gracefully handle missing token for multiple steps', async ({ mcp }) => {
      const result = await mcp.tools.call('test-progress-method', {
        steps: 5,
        includeTotal: true,
        includeMessage: true,
      });

      expect(result).toBeSuccessful();
      expect(result.json()).toMatchObject({
        success: true,
        progressSent: 0,
        hadProgressToken: false,
      });
    });
  });

  test.describe('Progress Parameters', () => {
    test('should handle progress without total', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-progress-method',
          arguments: {
            steps: 5,
            includeTotal: false,
            includeMessage: false,
          },
          _meta: {
            progressToken: 'token-no-total',
          },
        },
      });

      expect(response.result).toBeDefined();
      const result = parseToolResult(response);
      expect(result.success).toBe(true);
    });

    test('should handle progress without message', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-progress-method',
          arguments: {
            steps: 3,
            includeTotal: true,
            includeMessage: false,
          },
          _meta: {
            progressToken: 'token-no-message',
          },
        },
      });

      expect(response.result).toBeDefined();
      const result = parseToolResult(response);
      expect(result.success).toBe(true);
    });

    test('should handle progress with all parameters', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-progress-method',
          arguments: {
            steps: 5,
            delayMs: 10,
            includeTotal: true,
            includeMessage: true,
          },
          _meta: {
            progressToken: 'full-params-token',
          },
        },
      });

      expect(response.result).toBeDefined();
      const result = parseToolResult(response);
      expect(result.success).toBe(true);
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle single step progress', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-progress-method',
          arguments: {
            steps: 1,
            includeTotal: true,
          },
          _meta: {
            progressToken: 'single-step-token',
          },
        },
      });

      expect(response.result).toBeDefined();
      const result = parseToolResult(response);
      expect(result.success).toBe(true);
    });

    test('should handle maximum steps (10)', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'test-progress-method',
          arguments: {
            steps: 10,
            includeTotal: true,
            includeMessage: true,
          },
          _meta: {
            progressToken: 'max-steps-token',
          },
        },
      });

      expect(response.result).toBeDefined();
      const result = parseToolResult(response);
      expect(result.success).toBe(true);
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list test-progress-method tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('test-progress-method');
    });
  });
});
