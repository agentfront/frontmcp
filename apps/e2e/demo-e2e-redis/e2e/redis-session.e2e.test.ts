/**
 * E2E Tests for Redis Session Persistence (Mocked)
 *
 * Tests session data storage and retrieval:
 * - Store and retrieve session data
 * - Data persistence across requests
 * - TTL expiration handling
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Redis Session E2E (Mocked)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-redis/src/main.ts',
    publicMode: true,
  });

  test.describe('Session Data Storage', () => {
    test('should store data in session', async ({ mcp }) => {
      const result = await mcp.tools.call('set-session-data', {
        key: 'test-key',
        value: 'test-value',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('test-key');
    });

    test('should retrieve stored data', async ({ mcp }) => {
      // Store data
      await mcp.tools.call('set-session-data', {
        key: 'retrieve-key',
        value: 'retrieve-value',
      });

      // Retrieve data
      const result = await mcp.tools.call('get-session-data', {
        key: 'retrieve-key',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('retrieve-value');
    });

    test('should return null for non-existent key', async ({ mcp }) => {
      const result = await mcp.tools.call('get-session-data', {
        key: 'non-existent-key',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('null');
    });
  });

  test.describe('Session Persistence', () => {
    test('should persist data across multiple tool calls', async ({ mcp }) => {
      // Store multiple values
      await mcp.tools.call('set-session-data', { key: 'key1', value: 'value1' });
      await mcp.tools.call('set-session-data', { key: 'key2', value: 'value2' });
      await mcp.tools.call('set-session-data', { key: 'key3', value: 'value3' });

      // Retrieve all values
      const result1 = await mcp.tools.call('get-session-data', { key: 'key1' });
      const result2 = await mcp.tools.call('get-session-data', { key: 'key2' });
      const result3 = await mcp.tools.call('get-session-data', { key: 'key3' });

      expect(result1).toHaveTextContent('value1');
      expect(result2).toHaveTextContent('value2');
      expect(result3).toHaveTextContent('value3');
    });

    test('should maintain session across resource reads', async ({ mcp }) => {
      // Store data
      await mcp.tools.call('set-session-data', { key: 'resource-test', value: 'resource-value' });

      // Read session resource
      const content = await mcp.resources.read('session://current');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('resource-test');
    });
  });

  test.describe('TTL Expiration', () => {
    test('should store data with TTL parameter (expiration not verified)', async ({ mcp }) => {
      // Note: Actual TTL expiration cannot be tested without real time delays
      // This test only verifies TTL parameter is accepted
      const result = await mcp.tools.call('set-session-data', {
        key: 'ttl-key',
        value: 'ttl-value',
        ttlSeconds: 60,
      });

      expect(result).toBeSuccessful();

      // Should be accessible immediately
      const getResult = await mcp.tools.call('get-session-data', { key: 'ttl-key' });
      expect(getResult).toHaveTextContent('ttl-value');
    });
  });

  test.describe('Resource Access', () => {
    test('should list session resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('session://current');
    });

    test('should read current session data', async ({ mcp }) => {
      const content = await mcp.resources.read('session://current');
      expect(content).toBeSuccessful();
    });
  });

  test.describe('Prompt Access', () => {
    test('should list session prompts', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('session-summary');
    });

    test('should generate session summary', async ({ mcp }) => {
      // Store some data first
      await mcp.tools.call('set-session-data', { key: 'summary-key', value: 'summary-value' });

      const result = await mcp.prompts.get('session-summary', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      // Verify message content with proper type narrowing
      const message = result.messages[0];
      expect(message.content.type).toBe('text');
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('session');
      }
    });
  });

  test.describe('Error Handling', () => {
    test('should error on missing key parameter', async ({ mcp }) => {
      const result = await mcp.tools.call('set-session-data', {
        value: 'test-value',
        // key missing
      });
      expect(result).toBeError();
    });

    test('should error on negative TTL', async ({ mcp }) => {
      const result = await mcp.tools.call('set-session-data', {
        key: 'bad-ttl',
        value: 'value',
        ttlSeconds: -1,
      });
      expect(result).toBeError();
    });
  });
});
