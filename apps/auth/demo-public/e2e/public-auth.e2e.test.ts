/**
 * E2E Tests for Public Auth Mode
 *
 * Tests the public authentication mode where:
 * - No Authorization header is required
 * - Anonymous users can access all tools
 * - Sessions are created for anonymous users
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Public Auth Mode E2E', () => {
  test.use({
    server: './src/main.ts',
    publicMode: true,
  });

  test.describe('Anonymous Access', () => {
    test('should connect without authorization header', async ({ mcp }) => {
      expect(mcp.isConnected()).toBe(true);
      expect(mcp.serverInfo.name).toBeDefined();
    });

    test('should have anonymous auth state', async ({ mcp }) => {
      expect(mcp.auth.isAnonymous).toBe(true);
      expect(mcp.auth.token).toBeUndefined();
    });

    test('should create session for anonymous user', async ({ mcp }) => {
      expect(mcp.sessionId).toBeDefined();
    });
  });

  test.describe('Tool Access', () => {
    test('should list all tools without auth', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('create-note');
      expect(tools).toContainTool('list-notes');
      expect(tools).toContainTool('create-task');
      expect(tools).toContainTool('list-tasks');
      expect(tools).toContainTool('complete-task');
    });

    test('should call tools without auth', async ({ mcp }) => {
      const result = await mcp.tools.call('list-notes', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent();
    });

    test('should create and retrieve notes anonymously', async ({ mcp }) => {
      const createResult = await mcp.tools.call('create-note', {
        title: 'Anonymous Note',
        content: 'Created by anonymous user',
      });

      expect(createResult).toBeSuccessful();
      expect(createResult).toHaveTextContent('Anonymous Note');

      const listResult = await mcp.tools.call('list-notes', {});
      expect(listResult).toBeSuccessful();
    });
  });

  test.describe('Resource Access', () => {
    test('should list resources without auth', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('notes://all');
    });

    test('should list resource templates without auth', async ({ mcp }) => {
      const templates = await mcp.resources.listTemplates();
      expect(templates).toContainResourceTemplate('notes://note/{noteId}');
    });

    test('should read resources without auth', async ({ mcp }) => {
      const content = await mcp.resources.read('notes://all');

      expect(content).toBeSuccessful();
    });
  });

  test.describe('Prompt Access', () => {
    test('should list prompts without auth', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();

      expect(prompts).toContainPrompt('summarize-notes');
      expect(prompts).toContainPrompt('prioritize-tasks');
    });

    test('should get prompts without auth', async ({ mcp }) => {
      const result = await mcp.prompts.get('summarize-notes', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  test.describe('Authenticated Public Mode', () => {
    test('should accept valid tokens even in public mode', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read', 'write'],
        email: 'user@test.local',
      });

      const authenticatedClient = await server.createClient({ token });

      expect(authenticatedClient.isConnected()).toBe(true);
      expect(authenticatedClient.auth.isAnonymous).toBe(false);
      expect(authenticatedClient.auth.token).toBe(token);

      await authenticatedClient.disconnect();
    });
  });
});
