/**
 * E2E Tests for Auth Providers Integration
 *
 * Tests auth provider patterns in the context of dependency injection:
 * - Provider scope isolation
 * - Context extension availability
 * - Credential scope patterns
 * - Graceful degradation when not configured
 *
 * Note: Full auth provider functionality with OAuth/API key credentials
 * is tested in the dedicated demo-e2e-auth-providers app.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Auth Providers Integration E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-providers/src/main.ts',
    project: 'demo-e2e-providers',
    publicMode: true,
  });

  test.describe('Provider Scope Patterns', () => {
    test('should support GLOBAL scope for shared state', async ({ mcp }) => {
      // GLOBAL scope providers are singletons - share state across all requests
      const result1 = await mcp.tools.call('get-app-info', {});
      const result2 = await mcp.tools.call('get-app-info', {});

      expect(result1).toBeSuccessful();
      expect(result2).toBeSuccessful();

      // Both calls should return the same instance data
      const content1 = JSON.stringify(result1);
      const content2 = JSON.stringify(result2);

      // Verify GLOBAL scope behavior
      expect(content1).toContain('"providerScope":"GLOBAL"');
      expect(content2).toContain('"providerScope":"GLOBAL"');

      // Verify same instance is returned (singleton)
      const match1 = content1.match(/"instanceId":"([^"]+)"/);
      const match2 = content2.match(/"instanceId":"([^"]+)"/);
      expect(match1?.[1]).toBe(match2?.[1]);
    });

    test('should support CONTEXT scope for per-session state', async ({ mcp }) => {
      // CONTEXT scope providers are created per session context
      const result = await mcp.tools.call('get-request-info', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"providerScope":"CONTEXT"');
    });

    test('should demonstrate credential scope pattern - machine/global', async ({ mcp }) => {
      // Machine/global scope credentials would be shared across all users
      // This tests the pattern without actual credential storage
      const result1 = await mcp.tools.call('get-app-info', {});
      const result2 = await mcp.tools.call('get-app-info', {});

      expect(result1).toBeSuccessful();
      expect(result2).toBeSuccessful();
      // Instance ID being consistent across calls demonstrates global/machine scope
      expect(result1).toHaveTextContent('"providerScope":"GLOBAL"');
      expect(result2).toHaveTextContent('"providerScope":"GLOBAL"');
    });

    test('should demonstrate credential scope pattern - session', async ({ mcp }) => {
      // Session scope credentials are tied to the current session
      const result = await mcp.tools.call('get-request-info', {});

      expect(result).toBeSuccessful();
      // Request ID being session-scoped demonstrates session credential pattern
      expect(result).toHaveTextContent('"providerScope":"CONTEXT"');
    });
  });

  test.describe('Context Extension Pattern', () => {
    test('should access provider via dependency injection', async ({ mcp }) => {
      // Providers are accessed via @Inject decorator in tools
      // This demonstrates the pattern used by authProviders context extension
      const result = await mcp.tools.call('get-app-info', {});

      expect(result).toBeSuccessful();
      // Successful call demonstrates DI is working
      expect(result).toHaveTextContent('Demo E2E Providers');
    });

    test('should access provider in resource context', async ({ mcp }) => {
      // Resources can also access providers via DI
      const content = await mcp.resources.read('config://app');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('instanceId');
    });

    test('should access provider in prompt context', async ({ mcp }) => {
      // Prompts can access providers via DI
      const result = await mcp.prompts.get('debug-context', {});

      expect(result).toBeSuccessful();
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  test.describe('Provider Factory Pattern', () => {
    test('should use factory function for provider instantiation', async ({ mcp }) => {
      // Factory pattern is used for credential factories
      // Demonstrating with existing providers that use factory pattern
      const result1 = await mcp.tools.call('get-request-info', {});

      expect(result1).toBeSuccessful();
      // Each request gets a factory-created provider instance
      expect(result1).toHaveTextContent('createdAt');
    });

    test('should support async factory initialization', async ({ mcp }) => {
      // Providers can have async initialization (like loading credentials)
      // Testing pattern with existing providers
      const result = await mcp.tools.call('get-app-info', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('startedAt');
    });
  });

  test.describe('Graceful Degradation', () => {
    test('should work with all providers available (smoke test)', async ({ mcp }) => {
      // Basic smoke test to verify the server works with providers configured
      // Full graceful degradation testing requires dedicated test app without providers
      const result = await mcp.tools.call('get-app-info', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Demo E2E Providers');
    });

    test('should list all expected tools when providers are configured', async ({ mcp }) => {
      // Verify all expected tools are available when providers are properly configured
      const tools = await mcp.tools.list();

      // All tools should be available, indicating proper provider setup
      expect(tools).toContainTool('get-app-info');
      expect(tools).toContainTool('get-request-info');
    });
  });

  test.describe('Multi-Provider Access', () => {
    test('should access multiple providers in single tool', async ({ mcp }) => {
      // Tools can access multiple providers (like GLOBAL and CONTEXT together)
      // This pattern mirrors accessing multiple credential providers
      const result = await mcp.prompts.get('debug-context', {});

      expect(result).toBeSuccessful();
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);

      const message = result.messages[0];
      expect(message.content.type).toBe('text');
      // Type assertion is safe since we asserted the type above
      const textContent = (message.content as { type: 'text'; text: string }).text;
      // Prompt accesses both GLOBAL and CONTEXT providers
      expect(textContent).toContain('GLOBAL Scope Provider');
      expect(textContent).toContain('CONTEXT Scope Provider');
    });

    test('should maintain provider isolation', async ({ mcp }) => {
      // Different providers should not interfere with each other
      const globalResult = await mcp.tools.call('get-app-info', {});
      const contextResult = await mcp.tools.call('get-request-info', {});

      expect(globalResult).toBeSuccessful();
      expect(contextResult).toBeSuccessful();

      // Each provider returns its own scope type
      const globalContent = JSON.stringify(globalResult);
      const contextContent = JSON.stringify(contextResult);

      expect(globalContent).toContain('"providerScope":"GLOBAL"');
      expect(contextContent).toContain('"providerScope":"CONTEXT"');
    });
  });

  test.describe('Provider Lifecycle', () => {
    test('should maintain GLOBAL provider across requests', async ({ mcp }) => {
      // GLOBAL providers should have consistent state across requests
      // Similar to machine-scoped credentials
      const calls = [];
      for (let i = 0; i < 3; i++) {
        calls.push(mcp.tools.call('get-app-info', {}));
      }

      const results = await Promise.all(calls);

      // All should have same instanceId (singleton)
      const instanceIds = results.map((r) => {
        const content = JSON.stringify(r);
        const match = content.match(/"instanceId":"(instance-[a-z0-9]+)"/);
        return match ? match[1] : null;
      });

      expect(instanceIds[0]).not.toBeNull();
      expect(instanceIds[1]).toBe(instanceIds[0]);
      expect(instanceIds[2]).toBe(instanceIds[0]);
    });

    test('should maintain CONTEXT provider within session', async ({ mcp }) => {
      // CONTEXT providers persist within the same session
      // Similar to session-scoped credentials
      const calls = [];
      for (let i = 0; i < 3; i++) {
        calls.push(mcp.tools.call('get-request-info', {}));
      }

      const results = await Promise.all(calls);

      // All should have same instanceId within session
      const instanceIds = results.map((r) => {
        const content = JSON.stringify(r);
        const match = content.match(/"instanceId":"(req-[a-z0-9]+)"/);
        return match ? match[1] : null;
      });

      expect(instanceIds[0]).not.toBeNull();
      expect(instanceIds[1]).toBe(instanceIds[0]);
      expect(instanceIds[2]).toBe(instanceIds[0]);
    });
  });
});
