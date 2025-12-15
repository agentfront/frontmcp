/**
 * E2E Tests for CachePlugin
 *
 * Tests cache behavior with memory backend:
 * - Cached tool returns same result within TTL
 * - Non-cached tool returns fresh result every time
 * - Execution counts verify actual vs cached executions
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Cache E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-cache/src/main.ts',
    publicMode: true,
  });

  test.describe('Cached Tool Behavior', () => {
    test.beforeEach(async ({ mcp }) => {
      // Reset stats before each test
      await mcp.tools.call('reset-stats', {});
    });

    test('should execute cached tool on first call', async ({ mcp }) => {
      const result = await mcp.tools.call('expensive-operation', {
        operationId: 'test-1',
        complexity: 5,
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('test-1');
      expect(result).toHaveTextContent('executionCount');
    });

    test('should return cached result on subsequent calls with same input', async ({ mcp }) => {
      // First call - should execute
      await mcp.tools.call('expensive-operation', {
        operationId: 'cache-test',
        complexity: 3,
      });

      // Second call with same input - should return cached result
      await mcp.tools.call('expensive-operation', {
        operationId: 'cache-test',
        complexity: 3,
      });

      // Third call with same input
      await mcp.tools.call('expensive-operation', {
        operationId: 'cache-test',
        complexity: 3,
      });

      // Check execution count - should be 1 (only first call actually executed)
      const stats = await mcp.tools.call('get-cache-stats', {});

      expect(stats).toBeSuccessful();
      const statsContent = JSON.stringify(stats);

      // The expensive-operation should have been executed only once
      expect(statsContent).toContain('"expensive-operation":1');
    });

    test('should execute again with different input', async ({ mcp }) => {
      // First call with input A
      await mcp.tools.call('expensive-operation', {
        operationId: 'input-a',
        complexity: 2,
      });

      // Second call with different input B - should execute (different cache key)
      await mcp.tools.call('expensive-operation', {
        operationId: 'input-b',
        complexity: 2,
      });

      // Check execution count - should be 2 (different inputs = different cache keys)
      const stats = await mcp.tools.call('get-cache-stats', {});

      expect(stats).toBeSuccessful();
      const statsContent = JSON.stringify(stats);
      expect(statsContent).toContain('"expensive-operation":2');
    });
  });

  test.describe('Non-Cached Tool Behavior', () => {
    test.beforeEach(async ({ mcp }) => {
      await mcp.tools.call('reset-stats', {});
    });

    test('should execute every time without caching', async ({ mcp }) => {
      // Call the non-cached tool multiple times with same input
      await mcp.tools.call('non-cached', { operationId: 'test' });
      await mcp.tools.call('non-cached', { operationId: 'test' });
      await mcp.tools.call('non-cached', { operationId: 'test' });

      // Check execution count - should be 3 (no caching)
      const stats = await mcp.tools.call('get-cache-stats', {});

      expect(stats).toBeSuccessful();
      const statsContent = JSON.stringify(stats);
      expect(statsContent).toContain('"non-cached":3');
    });
  });

  test.describe('Cache vs Non-Cache Comparison', () => {
    test.beforeEach(async ({ mcp }) => {
      await mcp.tools.call('reset-stats', {});
    });

    test('should show difference between cached and non-cached tools', async ({ mcp }) => {
      // Call both tools 3 times each with same inputs
      for (let i = 0; i < 3; i++) {
        await mcp.tools.call('expensive-operation', { operationId: 'same', complexity: 1 });
        await mcp.tools.call('non-cached', { operationId: 'same' });
      }

      // Get stats
      const stats = await mcp.tools.call('get-cache-stats', {});
      expect(stats).toBeSuccessful();

      const statsContent = JSON.stringify(stats);

      // Cached tool: 1 execution (first call only)
      expect(statsContent).toContain('"expensive-operation":1');

      // Non-cached tool: 3 executions (every call)
      expect(statsContent).toContain('"non-cached":3');
    });
  });

  test.describe('Resource Access', () => {
    test('should list cache stats resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('cache://stats');
    });

    test('should read cache stats from resource', async ({ mcp }) => {
      // Make some calls first
      await mcp.tools.call('expensive-operation', { operationId: 'resource-test' });

      const content = await mcp.resources.read('cache://stats');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('executionCounts');
      expect(content).toHaveTextContent('totalExecutions');
    });
  });

  test.describe('Prompt Access', () => {
    test('should list cache-report prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('cache-report');
    });

    test('should generate cache report', async ({ mcp }) => {
      // Make some calls first
      await mcp.tools.call('expensive-operation', { operationId: 'report-test' });
      await mcp.tools.call('non-cached', { operationId: 'report-test' });

      const result = await mcp.prompts.get('cache-report', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('Execution Statistics');
        expect(message.content.text).toContain('expensive-operation');
      }
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list all cache tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('expensive-operation');
      expect(tools).toContainTool('non-cached');
      expect(tools).toContainTool('get-cache-stats');
      expect(tools).toContainTool('reset-stats');
    });
  });
});
