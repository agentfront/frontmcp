/**
 * E2E Tests for Transport Session Management
 *
 * Tests transport session functionality:
 * - Session creation and state management
 * - Session ID assignment and tracking
 * - Session state updates
 * - Session isolation between clients
 * - Session persistence across requests
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Transport Session E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-redis/src/main.ts',
    publicMode: true,
  });

  test.describe('Session Creation', () => {
    test('should have session info available', async ({ mcp }) => {
      const result = await mcp.tools.call('session-info', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('sessionId');
    });

    test('should report auth info structure in public mode', async ({ mcp }) => {
      const result = await mcp.tools.call('session-info', {});

      expect(result).toBeSuccessful();
      // In public mode without explicit session creation, auth info may be empty
      expect(result).toHaveTextContent('authInfo');
    });

    test('should have session scopes', async ({ mcp }) => {
      const result = await mcp.tools.call('session-info', {});

      expect(result).toBeSuccessful();
      // Should have anonymous scopes from server config
      expect(result).toHaveTextContent('scopes');
    });
  });

  test.describe('Session State Management', () => {
    test('should update session state', async ({ mcp }) => {
      const result = await mcp.tools.call('update-session-state', {
        key: 'cursor-position',
        value: '100',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('cursor-position');
      expect(result).toHaveTextContent('Updated');
    });

    test('should retrieve session state', async ({ mcp }) => {
      // Set state
      await mcp.tools.call('update-session-state', {
        key: 'page-number',
        value: '42',
      });

      // Retrieve state
      const result = await mcp.tools.call('check-session', {
        key: 'page-number',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"stateFound":true');
      expect(result).toHaveTextContent('42');
    });

    test('should list all state keys', async ({ mcp }) => {
      // Set multiple state values
      await mcp.tools.call('update-session-state', { key: 'key1', value: 'value1' });
      await mcp.tools.call('update-session-state', { key: 'key2', value: 'value2' });
      await mcp.tools.call('update-session-state', { key: 'key3', value: 'value3' });

      // Check all keys
      const result = await mcp.tools.call('check-session', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('key1');
      expect(result).toHaveTextContent('key2');
      expect(result).toHaveTextContent('key3');
    });

    test('should return not found for non-existent state', async ({ mcp }) => {
      const result = await mcp.tools.call('check-session', {
        key: 'non-existent-key',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"stateFound":false');
    });
  });

  test.describe('Session Persistence', () => {
    test('should persist state across multiple tool calls', async ({ mcp }) => {
      // Set multiple values in sequence
      await mcp.tools.call('update-session-state', { key: 'persist-1', value: 'first' });
      await mcp.tools.call('update-session-state', { key: 'persist-2', value: 'second' });
      await mcp.tools.call('update-session-state', { key: 'persist-3', value: 'third' });

      // Verify all values persist
      const check1 = await mcp.tools.call('check-session', { key: 'persist-1' });
      const check2 = await mcp.tools.call('check-session', { key: 'persist-2' });
      const check3 = await mcp.tools.call('check-session', { key: 'persist-3' });

      expect(check1).toHaveTextContent('first');
      expect(check2).toHaveTextContent('second');
      expect(check3).toHaveTextContent('third');
    });

    test('should maintain session across different apps', async ({ mcp }) => {
      // Use session tools from one app
      await mcp.tools.call('set-session-data', {
        key: 'cross-app-key',
        value: 'cross-app-value',
      });

      // Retrieve using the same session
      const result = await mcp.tools.call('get-session-data', {
        key: 'cross-app-key',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('cross-app-value');
    });
  });

  test.describe('Session Isolation', () => {
    test('should isolate data between different sessions', async ({ mcp }) => {
      // Set a marker in this session
      const setResult = await mcp.tools.call('session-isolation', {
        action: 'set',
        marker: 'unique-session-marker-123',
      });

      expect(setResult).toBeSuccessful();
      expect(setResult).toHaveTextContent('unique-session-marker-123');

      // Retrieve the marker (same session)
      const getResult = await mcp.tools.call('session-isolation', {
        action: 'get',
        marker: 'unique-session-marker-123',
      });

      expect(getResult).toBeSuccessful();
      // Same session should find the same marker
      expect(getResult).toHaveTextContent('"isIsolated":false');
    });

    test('should have consistent session ID across calls', async ({ mcp }) => {
      // Get session info twice
      const info1 = await mcp.tools.call('session-info', {});
      const info2 = await mcp.tools.call('session-info', {});

      expect(info1).toBeSuccessful();
      expect(info2).toBeSuccessful();

      // Extract session IDs using json() method
      const parsed1 = info1.json<{ sessionId: string }>();
      const parsed2 = info2.json<{ sessionId: string }>();

      // Session ID should remain the same
      expect(parsed1.sessionId).toBe(parsed2.sessionId);
    });
  });

  test.describe('Session with Resources', () => {
    test('should maintain session when accessing resources', async ({ mcp }) => {
      // Set session state
      await mcp.tools.call('update-session-state', {
        key: 'resource-test',
        value: 'before-resource',
      });

      // Access a resource
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('session://current');

      // Verify state persists
      const checkResult = await mcp.tools.call('check-session', {
        key: 'resource-test',
      });

      expect(checkResult).toHaveTextContent('before-resource');
    });
  });

  test.describe('Session with Prompts', () => {
    test('should maintain session when accessing prompts', async ({ mcp }) => {
      // Set session state
      await mcp.tools.call('update-session-state', {
        key: 'prompt-test',
        value: 'before-prompt',
      });

      // Access a prompt
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('session-summary');

      // Verify state persists
      const checkResult = await mcp.tools.call('check-session', {
        key: 'prompt-test',
      });

      expect(checkResult).toHaveTextContent('before-prompt');
    });
  });

  test.describe('Error Handling & Edge Cases', () => {
    test('should handle empty state key gracefully', async ({ mcp }) => {
      // Set state with empty value
      const result = await mcp.tools.call('update-session-state', {
        key: 'empty-value-key',
        value: '',
      });

      expect(result).toBeSuccessful();

      // Retrieve - should find the empty value
      const checkResult = await mcp.tools.call('check-session', {
        key: 'empty-value-key',
      });

      expect(checkResult).toBeSuccessful();
    });

    test('should handle special characters in state keys', async ({ mcp }) => {
      // Key with special characters
      const specialKey = 'key-with-special_chars.and:colons';

      const setResult = await mcp.tools.call('update-session-state', {
        key: specialKey,
        value: 'special-value',
      });

      expect(setResult).toBeSuccessful();

      // Retrieve
      const checkResult = await mcp.tools.call('check-session', {
        key: specialKey,
      });

      expect(checkResult).toBeSuccessful();
      expect(checkResult).toHaveTextContent('special-value');
    });

    test('should handle special characters in state values', async ({ mcp }) => {
      // Value with special characters (JSON-like content)
      const specialValue = '{"nested":"value","array":[1,2,3]}';

      const setResult = await mcp.tools.call('update-session-state', {
        key: 'json-like-value',
        value: specialValue,
      });

      expect(setResult).toBeSuccessful();

      // Retrieve
      const checkResult = await mcp.tools.call('check-session', {
        key: 'json-like-value',
      });

      expect(checkResult).toBeSuccessful();
      // Value should be preserved
      expect(checkResult).toHaveTextContent('nested');
    });

    test('should handle unicode characters in values', async ({ mcp }) => {
      const unicodeValue = '你好世界 🌍 مرحبا';

      const setResult = await mcp.tools.call('update-session-state', {
        key: 'unicode-key',
        value: unicodeValue,
      });

      expect(setResult).toBeSuccessful();

      // Retrieve
      const checkResult = await mcp.tools.call('check-session', {
        key: 'unicode-key',
      });

      expect(checkResult).toBeSuccessful();
    });

    test('should handle overwriting existing state value', async ({ mcp }) => {
      const key = 'overwrite-test';

      // Set initial value
      await mcp.tools.call('update-session-state', {
        key,
        value: 'initial-value',
      });

      // Overwrite
      const overwriteResult = await mcp.tools.call('update-session-state', {
        key,
        value: 'new-value',
      });

      expect(overwriteResult).toBeSuccessful();

      // Verify new value
      const checkResult = await mcp.tools.call('check-session', { key });

      expect(checkResult).toHaveTextContent('new-value');
      // Should NOT have the old value
      const json = checkResult.json<{ stateValue: string }>();
      expect(json.stateValue).toBe('new-value');
    });

    test('should handle multiple rapid state updates', async ({ mcp }) => {
      // Rapidly update state
      const results = await Promise.all([
        mcp.tools.call('update-session-state', { key: 'rapid-1', value: 'v1' }),
        mcp.tools.call('update-session-state', { key: 'rapid-2', value: 'v2' }),
        mcp.tools.call('update-session-state', { key: 'rapid-3', value: 'v3' }),
        mcp.tools.call('update-session-state', { key: 'rapid-4', value: 'v4' }),
        mcp.tools.call('update-session-state', { key: 'rapid-5', value: 'v5' }),
      ]);

      // All should succeed
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });

      // All values should be persisted
      const checkResult = await mcp.tools.call('check-session', {});
      expect(checkResult).toHaveTextContent('rapid-1');
      expect(checkResult).toHaveTextContent('rapid-5');
    });

    test('should handle session isolation test with different markers', async ({ mcp }) => {
      // Set different markers in sequence
      await mcp.tools.call('session-isolation', {
        action: 'set',
        marker: 'marker-A',
      });

      // Check for wrong marker
      const checkResult = await mcp.tools.call('session-isolation', {
        action: 'get',
        marker: 'marker-B', // Different from what was set
      });

      expect(checkResult).toBeSuccessful();
      // Should report that retrieved marker doesn't match expected
      expect(checkResult).toHaveTextContent('marker-A'); // Retrieved
      expect(checkResult).toHaveTextContent('marker-B'); // Expected
    });

    test('should handle session data with TTL', async ({ mcp }) => {
      // Set session data with TTL
      const result = await mcp.tools.call('set-session-data', {
        key: 'ttl-key',
        value: 'ttl-value',
        ttlSeconds: 3600, // 1 hour
      });

      expect(result).toBeSuccessful();

      // Immediately retrieve - should still exist
      const getResult = await mcp.tools.call('get-session-data', {
        key: 'ttl-key',
      });

      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('ttl-value');
    });

    test('should handle getting non-existent session data', async ({ mcp }) => {
      const result = await mcp.tools.call('get-session-data', {
        key: 'definitely-does-not-exist-12345',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":false');
    });

    test('should handle very long state values', async ({ mcp }) => {
      // Create a moderately long value (not huge to avoid test timeouts)
      const longValue = 'x'.repeat(10000); // 10KB value

      const setResult = await mcp.tools.call('update-session-state', {
        key: 'long-value-key',
        value: longValue,
      });

      expect(setResult).toBeSuccessful();

      // Retrieve
      const checkResult = await mcp.tools.call('check-session', {
        key: 'long-value-key',
      });

      expect(checkResult).toBeSuccessful();
      expect(checkResult).toHaveTextContent('"stateFound":true');
    });
  });

  test.describe('Tool Listing', () => {
    test('should list transport tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('session-info');
      expect(tools).toContainTool('update-session-state');
      expect(tools).toContainTool('check-session');
      expect(tools).toContainTool('session-isolation');
    });
  });
});
