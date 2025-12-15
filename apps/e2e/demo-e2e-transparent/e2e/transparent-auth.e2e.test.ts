/**
 * E2E Tests for Transparent Auth Mode
 *
 * Tests the transparent authentication mode where:
 * - Tokens are validated against remote IdP
 * - User claims are extracted from validated tokens
 * - Anonymous access is not allowed
 */
import { test, expect, httpMock } from '@frontmcp/testing';

test.describe('Transparent Auth Mode E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-transparent/src/main.ts',
    publicMode: false,
  });

  test.describe('Authentication Required', () => {
    test('should reject requests without valid token', async ({ server }) => {
      // Attempting to connect without a token should fail
      await expect(server.createClient()).rejects.toThrow();
    });

    test('should accept valid tokens', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read', 'write'],
        email: 'user@test.local',
      });

      const mcp = await server.createClient({ token });

      expect(mcp.isConnected()).toBe(true);
      expect(mcp.auth.isAnonymous).toBe(false);

      await mcp.disconnect();
    });
  });

  test.describe('Token Validation', () => {
    test('should reject expired tokens', async ({ server, auth }) => {
      const expiredToken = await auth.createToken({
        sub: 'user-123',
        scopes: ['read'],
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      });

      await expect(server.createClient({ token: expiredToken })).rejects.toThrow();
    });

    test('should extract user claims from token', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-456',
        email: 'test@example.com',
        scopes: ['read', 'write'],
        roles: ['admin'],
      });

      const mcp = await server.createClient({ token });

      expect(mcp.auth.user?.sub).toBe('user-456');
      expect(mcp.auth.user?.email).toBe('test@example.com');

      await mcp.disconnect();
    });
  });

  test.describe('Tool Access with Auth', () => {
    test('should allow authenticated users to list tools', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-789',
        scopes: ['read'],
      });

      const mcp = await server.createClient({ token });
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('create-task');
      expect(tools).toContainTool('list-tasks');

      await mcp.disconnect();
    });

    test('should associate created tasks with user', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-creator',
        scopes: ['read', 'write'],
      });

      const mcp = await server.createClient({ token });

      const createResult = await mcp.tools.call('create-task', {
        title: 'Test Task',
        description: 'Created by authenticated user',
        priority: 'high',
      });

      expect(createResult).toBeSuccessful();
      expect(createResult).toHaveTextContent('user-creator');

      await mcp.disconnect();
    });
  });

  test.describe('Resource Access with Auth', () => {
    test('should allow authenticated users to read resources', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-reader',
        scopes: ['read'],
      });

      const mcp = await server.createClient({ token });
      const resources = await mcp.resources.list();

      expect(resources).toContainResource('tasks://all');

      const content = await mcp.resources.read('tasks://all');
      expect(content).toBeSuccessful();

      await mcp.disconnect();
    });
  });

  test.describe('Prompt Access with Auth', () => {
    test('should allow authenticated users to get prompts', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-prompter',
        scopes: ['read'],
      });

      const mcp = await server.createClient({ token });
      const prompts = await mcp.prompts.list();

      expect(prompts).toContainPrompt('prioritize-tasks');

      const result = await mcp.prompts.get('prioritize-tasks', { criteria: 'importance' });
      expect(result).toBeSuccessful();

      await mcp.disconnect();
    });
  });
});
