/**
 * E2E Tests for Serverless Deployments
 *
 * Tests serverless deployment functionality:
 * - Serverless info detection
 * - Cold start behavior
 * - Environment information
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Serverless Deployment E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-serverless/src/main.ts',
    project: 'demo-e2e-serverless',
    publicMode: true,
  });

  test.describe('Serverless Info', () => {
    test('should return deployment environment info', async ({ mcp }) => {
      const result = await mcp.tools.call('serverless-info', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('platform');
      expect(result).toHaveTextContent('runtime');
      expect(result).toHaveTextContent('stats');
    });

    test('should detect platform correctly', async ({ mcp }) => {
      const result = await mcp.tools.call('serverless-info', {});

      expect(result).toBeSuccessful();
      // In test environment, platform should be detected
      expect(result).toHaveTextContent('test');
    });

    test('should track invocation statistics', async ({ mcp }) => {
      // Make multiple calls to track statistics
      await mcp.tools.call('serverless-info', {});
      const result = await mcp.tools.call('serverless-info', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('totalInvocations');
    });
  });

  test.describe('Cold Start Testing', () => {
    test('should detect cold start on first invocation', async ({ mcp }) => {
      const result = await mcp.tools.call('cold-start-test', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('isColdStart');
      expect(result).toHaveTextContent('invocationId');
    });

    test('should detect warm start on subsequent invocations', async ({ mcp }) => {
      // First call (cold start)
      await mcp.tools.call('cold-start-test', {});

      // Second call (should be warm)
      const result = await mcp.tools.call('cold-start-test', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('warm');
    });

    test('should simulate cold start when requested', async ({ mcp }) => {
      const result = await mcp.tools.call('cold-start-test', {
        simulateColdStart: true,
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('isColdStart');
    });

    test('should track previous invocations', async ({ mcp }) => {
      await mcp.tools.call('cold-start-test', {});
      await mcp.tools.call('cold-start-test', {});
      const result = await mcp.tools.call('cold-start-test', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('previousInvocations');
    });
  });

  test.describe('Serverless Environment Resource', () => {
    test('should list serverless environment resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('serverless://env');
    });

    test('should read environment information', async ({ mcp }) => {
      const content = await mcp.resources.read('serverless://env');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('environment');
      expect(content).toHaveTextContent('nodeVersion');
    });

    test('should include process information', async ({ mcp }) => {
      const content = await mcp.resources.read('serverless://env');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('process');
      expect(content).toHaveTextContent('memoryUsage');
    });

    test('should include tracker statistics', async ({ mcp }) => {
      // Make some invocations first
      await mcp.tools.call('serverless-info', {});

      const content = await mcp.resources.read('serverless://env');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('tracker');
    });
  });

  test.describe('Deployment Check Prompt', () => {
    test('should list deployment-check prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('deployment-check');
    });

    test('should generate basic deployment check', async ({ mcp }) => {
      const result = await mcp.prompts.get('deployment-check', {});

      expect(result).toBeSuccessful();
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    test('should include verbose information when requested', async ({ mcp }) => {
      const result = await mcp.prompts.get('deployment-check', { verbose: 'true' });

      expect(result).toBeSuccessful();
      expect(result.messages).toHaveLength(1);
    });

    test('should show health status', async ({ mcp }) => {
      const result = await mcp.prompts.get('deployment-check', {});

      expect(result).toBeSuccessful();
      expect(result.messages).toHaveLength(1);
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list all serverless demo tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('serverless-info');
      expect(tools).toContainTool('cold-start-test');
    });
  });

  test.describe('Stateless HTTP Mode', () => {
    test('should work without persistent session', async ({ mcp }) => {
      // Make calls without explicit session management
      const result1 = await mcp.tools.call('serverless-info', {});
      const result2 = await mcp.tools.call('cold-start-test', {});

      expect(result1).toBeSuccessful();
      expect(result2).toBeSuccessful();
    });
  });
});
