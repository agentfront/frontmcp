/**
 * E2E Tests for RememberPlugin
 *
 * Tests session memory behavior with memory backend:
 * - Store and recall values using this.remember
 * - Session-scoped storage persists within session
 * - Forget clears stored values
 * - List shows all stored keys
 * - knows() checks for existence
 */
import { test, expect } from '@frontmcp/testing';

// Enable verbose logging only when DEBUG_E2E is set
const DEBUG = process.env['DEBUG_E2E'] === '1';

test.describe('Remember Plugin E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-remember/src/main.ts',
    project: 'demo-e2e-remember',
    publicMode: true,
    logLevel: DEBUG ? 'debug' : 'warn',
  });

  test.describe('Basic Remember/Recall Operations', () => {
    test('should remember a value and recall it', async ({ mcp }) => {
      // Store a value
      const storeResult = await mcp.tools.call('remember-value', {
        key: 'greeting',
        value: 'Hello, World!',
      });

      expect(storeResult).toBeSuccessful();
      expect(storeResult).toHaveTextContent('success');
      expect(storeResult).toHaveTextContent('greeting');

      // Recall the value
      const recallResult = await mcp.tools.call('recall-value', {
        key: 'greeting',
      });

      expect(recallResult).toBeSuccessful();
      expect(recallResult).toHaveTextContent('"found":true');
      expect(recallResult).toHaveTextContent('Hello, World!');
    });

    test('should return not found for non-existent key', async ({ mcp }) => {
      const result = await mcp.tools.call('recall-value', {
        key: 'non-existent-key-12345',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":false');
      expect(result).toHaveTextContent('"value":null');
    });

    test('should overwrite existing value with same key', async ({ mcp }) => {
      // Store initial value
      await mcp.tools.call('remember-value', {
        key: 'counter',
        value: 'one',
      });

      // Overwrite with new value
      await mcp.tools.call('remember-value', {
        key: 'counter',
        value: 'two',
      });

      // Recall should get the new value
      const result = await mcp.tools.call('recall-value', {
        key: 'counter',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":true');
      expect(result).toHaveTextContent('two');
    });
  });

  test.describe('Forget Operations', () => {
    test('should forget a stored value', async ({ mcp }) => {
      // Store a value
      await mcp.tools.call('remember-value', {
        key: 'to-forget',
        value: 'temporary',
      });

      // Verify it exists
      const beforeForget = await mcp.tools.call('recall-value', {
        key: 'to-forget',
      });
      expect(beforeForget).toHaveTextContent('"found":true');

      // Forget it
      const forgetResult = await mcp.tools.call('forget-value', {
        key: 'to-forget',
      });
      expect(forgetResult).toBeSuccessful();
      expect(forgetResult).toHaveTextContent('Forgot');

      // Verify it's gone
      const afterForget = await mcp.tools.call('recall-value', {
        key: 'to-forget',
      });
      expect(afterForget).toHaveTextContent('"found":false');
    });

    test('should handle forgetting non-existent key gracefully', async ({ mcp }) => {
      const result = await mcp.tools.call('forget-value', {
        key: 'never-existed',
      });

      expect(result).toBeSuccessful();
    });
  });

  test.describe('Check Memory (knows) Operations', () => {
    test('should return true for existing key', async ({ mcp }) => {
      // Store a value
      await mcp.tools.call('remember-value', {
        key: 'check-exists',
        value: 'present',
      });

      // Check it exists
      const result = await mcp.tools.call('check-memory', {
        key: 'check-exists',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"exists":true');
    });

    test('should return false for non-existent key', async ({ mcp }) => {
      const result = await mcp.tools.call('check-memory', {
        key: 'does-not-exist-xyz',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"exists":false');
    });
  });

  test.describe('List Memories Operations', () => {
    test('should list stored keys', async ({ mcp }) => {
      // Store multiple values with unique prefix to avoid collision
      const prefix = `list-test-${Date.now()}`;
      await mcp.tools.call('remember-value', {
        key: `${prefix}-a`,
        value: 'value-a',
      });
      await mcp.tools.call('remember-value', {
        key: `${prefix}-b`,
        value: 'value-b',
      });

      // List memories
      const result = await mcp.tools.call('list-memories', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent(prefix);
    });
  });

  test.describe('Scope Isolation', () => {
    test('should isolate session scope from global scope', async ({ mcp }) => {
      const testKey = `scope-test-${Date.now()}`;

      // Store in session scope
      await mcp.tools.call('remember-value', {
        key: testKey,
        value: 'session-value',
        scope: 'session',
      });

      // Recall from session scope - should find it
      const sessionResult = await mcp.tools.call('recall-value', {
        key: testKey,
        scope: 'session',
      });
      expect(sessionResult).toHaveTextContent('"found":true');
      expect(sessionResult).toHaveTextContent('session-value');

      // Recall from global scope - should not find it
      const globalResult = await mcp.tools.call('recall-value', {
        key: testKey,
        scope: 'global',
      });
      expect(globalResult).toHaveTextContent('"found":false');
    });

    test('should store and recall from global scope', async ({ mcp }) => {
      const testKey = `global-test-${Date.now()}`;

      // Store in global scope
      await mcp.tools.call('remember-value', {
        key: testKey,
        value: 'global-value',
        scope: 'global',
      });

      // Recall from global scope
      const result = await mcp.tools.call('recall-value', {
        key: testKey,
        scope: 'global',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":true');
      expect(result).toHaveTextContent('global-value');
    });
  });

  test.describe('Resource Access', () => {
    test('should list memory stats resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('memory://stats');
    });

    test('should read memory stats from resource', async ({ mcp }) => {
      // Store something first
      await mcp.tools.call('remember-value', {
        key: 'resource-test',
        value: 'test-value',
      });

      const content = await mcp.resources.read('memory://stats');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('session');
      expect(content).toHaveTextContent('keyCount');
    });
  });

  test.describe('Prompt Access', () => {
    test('should list memory-summary prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('memory-summary');
    });

    test('should generate memory summary', async ({ mcp }) => {
      // Store something first
      const uniqueKey = `prompt-test-${Date.now()}`;
      await mcp.tools.call('remember-value', {
        key: uniqueKey,
        value: 'prompt-test-value',
      });

      const result = await mcp.prompts.get('memory-summary', { scope: 'session' });

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      const message = result.messages[0];
      expect(message.content.type).toBe('text');
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('Memory Summary');
        expect(message.content.text).toContain('session');
      } else {
        throw new Error(`Expected text content type but got: ${message.content.type}`);
      }
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list all remember tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('remember-value');
      expect(tools).toContainTool('recall-value');
      expect(tools).toContainTool('forget-value');
      expect(tools).toContainTool('list-memories');
      expect(tools).toContainTool('check-memory');
    });
  });

  test.describe('Error Scenarios', () => {
    test('should handle missing required key parameter', async ({ mcp }) => {
      const result = await mcp.tools.call('remember-value', {
        value: 'no-key-provided',
      });

      expect(result).toBeError();
      expect(result).toHaveTextContent('key');
    });

    test('should handle missing required value parameter', async ({ mcp }) => {
      const result = await mcp.tools.call('remember-value', {
        key: 'test-key',
      });

      expect(result).toBeError();
      expect(result).toHaveTextContent('value');
    });
  });
});
