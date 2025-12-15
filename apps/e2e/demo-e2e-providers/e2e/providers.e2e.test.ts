/**
 * E2E Tests for Custom Providers & Dependency Injection
 *
 * Tests provider scopes and DI patterns:
 * - GLOBAL scope (singleton) provider behavior
 * - CONTEXT scope (per-request) provider behavior
 * - Dependency injection from tools/resources/prompts
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Providers E2E', () => {
  test.use({
    server: './src/main.ts',
    publicMode: true,
  });

  test.describe('GLOBAL Scope Provider', () => {
    test('should return app info from singleton provider', async ({ mcp }) => {
      const result = await mcp.tools.call('get-app-info', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Demo E2E Providers');
      expect(result).toHaveTextContent('GLOBAL');
    });

    test('should return consistent instanceId across multiple calls', async ({ mcp }) => {
      const result1 = await mcp.tools.call('get-app-info', {});
      const result2 = await mcp.tools.call('get-app-info', {});

      expect(result1).toBeSuccessful();
      expect(result2).toBeSuccessful();

      // Extract instanceId from both results - should be the same (singleton)
      const content1 = JSON.stringify(result1);
      const content2 = JSON.stringify(result2);

      // Both should have the same structure and instance ID
      const instanceIdMatch1 = content1.match(/"instanceId":"([a-f0-9\-]+)"/);
      const instanceIdMatch2 = content2.match(/"instanceId":"([a-f0-9\-]+)"/);

      expect(instanceIdMatch1).not.toBeNull();
      expect(instanceIdMatch2).not.toBeNull();
      if (instanceIdMatch1 && instanceIdMatch2) {
        expect(instanceIdMatch1[1]).toBe(instanceIdMatch2[1]);
      }
    });

    test('should have consistent startedAt timestamp', async ({ mcp }) => {
      const result1 = await mcp.tools.call('get-app-info', {});
      const result2 = await mcp.tools.call('get-app-info', {});

      const content1 = JSON.stringify(result1);
      const content2 = JSON.stringify(result2);

      // Both should have the same startedAt timestamp
      const startedAtMatch1 = content1.match(/"startedAt":"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)"/);
      const startedAtMatch2 = content2.match(/"startedAt":"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)"/);

      expect(startedAtMatch1).not.toBeNull();
      expect(startedAtMatch2).not.toBeNull();
      if (startedAtMatch1 && startedAtMatch2) {
        expect(startedAtMatch1[1]).toBe(startedAtMatch2[1]);
      }
    });
  });

  test.describe('CONTEXT Scope Provider', () => {
    test('should return request info from context provider', async ({ mcp }) => {
      const result = await mcp.tools.call('get-request-info', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('CONTEXT');
    });

    test('should create new instance per request', async ({ mcp }) => {
      const result1 = await mcp.tools.call('get-request-info', {});
      const result2 = await mcp.tools.call('get-request-info', {});

      expect(result1).toBeSuccessful();
      expect(result2).toBeSuccessful();

      // Extract instanceId from both results - should be different (per-request)
      const content1 = JSON.stringify(result1);
      const content2 = JSON.stringify(result2);

      const instanceIdMatch1 = content1.match(/"instanceId":"([a-f0-9\-]+)"/);
      const instanceIdMatch2 = content2.match(/"instanceId":"([a-f0-9\-]+)"/);

      expect(instanceIdMatch1).not.toBeNull();
      expect(instanceIdMatch2).not.toBeNull();
      // CONTEXT scope creates new instance per request
      if (instanceIdMatch1 && instanceIdMatch2) {
        expect(instanceIdMatch1[1]).not.toBe(instanceIdMatch2[1]);
      }
    });

    test('should log messages within request context', async ({ mcp }) => {
      const result = await mcp.tools.call('get-request-info', {
        logMessage: 'Test log message',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Test log message');
    });
  });

  test.describe('Resource with Provider', () => {
    test('should list config resource', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('config://app');
    });

    test('should read config from GLOBAL provider', async ({ mcp }) => {
      const content = await mcp.resources.read('config://app');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('Demo E2E Providers');
      expect(content).toHaveTextContent('instanceId');
      expect(content).toHaveTextContent('uptime');
    });

    test('should have increasing uptime on successive reads', async ({ mcp }) => {
      const content1 = await mcp.resources.read('config://app');

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      const content2 = await mcp.resources.read('config://app');

      expect(content1).toBeSuccessful();
      expect(content2).toBeSuccessful();

      // Extract uptime values
      const str1 = JSON.stringify(content1);
      const str2 = JSON.stringify(content2);

      const uptimeMatch1 = str1.match(/"uptime":(\d+)/);
      const uptimeMatch2 = str2.match(/"uptime":(\d+)/);

      if (uptimeMatch1 && uptimeMatch2) {
        const uptime1 = parseInt(uptimeMatch1[1], 10);
        const uptime2 = parseInt(uptimeMatch2[1], 10);
        expect(uptime2).toBeGreaterThanOrEqual(uptime1);
      }
    });
  });

  test.describe('Prompt with Providers', () => {
    test('should list debug-context prompt', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('debug-context');
    });

    test('should access both GLOBAL and CONTEXT providers in prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('debug-context', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      // Should contain info about both providers
      const message = result.messages[0];
      if (message.content.type === 'text') {
        expect(message.content.text).toContain('GLOBAL Scope Provider');
        expect(message.content.text).toContain('CONTEXT Scope Provider');
        expect(message.content.text).toContain('Demo E2E Providers');
      }
    });
  });

  test.describe('Tool Discovery', () => {
    test('should list all provider tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('get-app-info');
      expect(tools).toContainTool('get-request-info');
    });
  });
});
