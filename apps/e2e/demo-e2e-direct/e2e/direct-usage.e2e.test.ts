/**
 * E2E Tests for Direct Usage of FrontMCP
 *
 * Tests the programmatic/direct access APIs:
 * - FrontMcpInstance.createDirect() - Direct server API
 * - createInMemoryServer() - In-memory transport for MCP SDK Client
 *
 * These APIs enable:
 * - Embedding MCP servers in existing applications
 * - Unit/integration testing without HTTP
 * - LangChain MCP adapter integration
 * - Agent backends with custom invocation
 */

import { FrontMcpInstance, createInMemoryServer, DirectMcpServer } from '@frontmcp/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { serverConfig } from '../src/main';
import { notesStore } from '../src/apps/notes/data/notes.store';

describe('Direct Usage E2E', () => {
  beforeEach(() => {
    // Clear the notes store before each test
    notesStore.clear();
  });

  describe('FrontMcpInstance.createDirect()', () => {
    let server: DirectMcpServer;

    beforeEach(async () => {
      server = await FrontMcpInstance.createDirect(serverConfig);
    });

    afterEach(async () => {
      await server.dispose();
    });

    describe('Tool Operations', () => {
      it('should list all tools', async () => {
        const result = await server.listTools();

        expect(result.tools).toBeDefined();
        expect(result.tools.length).toBeGreaterThan(0);

        const toolNames = result.tools.map((t) => t.name);
        expect(toolNames).toContain('create-note');
        expect(toolNames).toContain('list-notes');
      });

      it('should call tools without auth context', async () => {
        const result = await server.callTool('list-notes', {});

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
      });

      it('should call tools with auth context', async () => {
        const result = await server.callTool(
          'create-note',
          { title: 'Test Note', content: 'Test Content' },
          { authContext: { token: 'test-token', sessionId: 'user-123' } },
        );

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(result.isError).not.toBe(true);
      });

      it('should create and retrieve notes', async () => {
        // Create a note
        const createResult = await server.callTool('create-note', {
          title: 'My Test Note',
          content: 'This is test content',
        });

        expect(createResult).toBeDefined();
        expect(createResult.isError).not.toBe(true);

        // List notes to verify
        const listResult = await server.callTool('list-notes', {});

        expect(listResult).toBeDefined();
        expect(listResult.content).toBeDefined();
      });
    });

    describe('Resource Operations', () => {
      it('should list all resources', async () => {
        const result = await server.listResources();

        expect(result.resources).toBeDefined();
        expect(result.resources.length).toBeGreaterThanOrEqual(0);
      });

      it('should list resource templates', async () => {
        const result = await server.listResourceTemplates();

        expect(result.resourceTemplates).toBeDefined();
      });

      it('should read resources', async () => {
        // First, create a note to ensure there's data
        await server.callTool('create-note', {
          title: 'Note for Resource Test',
          content: 'Content for resource test',
        });

        const result = await server.readResource('notes://all');

        expect(result).toBeDefined();
        expect(result.contents).toBeDefined();
      });
    });

    describe('Prompt Operations', () => {
      it('should list all prompts', async () => {
        const result = await server.listPrompts();

        expect(result.prompts).toBeDefined();
        expect(result.prompts.length).toBeGreaterThan(0);

        const promptNames = result.prompts.map((p) => p.name);
        expect(promptNames).toContain('summarize-notes');
      });

      it('should get prompt without arguments', async () => {
        const result = await server.getPrompt('summarize-notes', {});

        expect(result).toBeDefined();
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
      });

      it('should get prompt with arguments', async () => {
        const result = await server.getPrompt('summarize-notes', { format: 'detailed' });

        expect(result).toBeDefined();
        expect(result.messages).toBeDefined();
        expect(result.messages.length).toBeGreaterThan(0);
      });
    });

    describe('Auth Context', () => {
      it('should pass auth context to tool execution', async () => {
        const result = await server.callTool(
          'create-note',
          { title: 'Auth Test', content: 'Testing auth context' },
          {
            authContext: {
              token: 'jwt-token-123',
              sessionId: 'session-456',
              user: { sub: 'user-789' },
              extra: { customField: 'value' },
            },
          },
        );

        expect(result).toBeDefined();
        expect(result.isError).not.toBe(true);
      });
    });

    describe('Lifecycle', () => {
      it('should handle multiple calls in sequence', async () => {
        // Create multiple notes
        for (let i = 0; i < 5; i++) {
          const result = await server.callTool('create-note', {
            title: `Note ${i}`,
            content: `Content ${i}`,
          });
          expect(result.isError).not.toBe(true);
        }

        // List all notes
        const listResult = await server.callTool('list-notes', {});
        expect(listResult).toBeDefined();
      });

      it('should throw after dispose', async () => {
        await server.dispose();

        await expect(server.listTools()).rejects.toThrow('disposed');
      });
    });
  });

  describe('createInMemoryServer()', () => {
    it('should create in-memory server and connect client', async () => {
      // Create FrontMCP instance
      const frontMcp = await FrontMcpInstance.createForGraph(serverConfig);
      const scope = frontMcp.getScopes()[0];

      // Create in-memory server
      const { clientTransport, close } = await createInMemoryServer(scope as any, {
        authInfo: { token: 'test-token' },
      });

      // Create MCP client and connect
      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      // Verify connection
      expect(client).toBeDefined();

      // Cleanup
      await client.close();
      await close();
    });

    it('should list tools via MCP client', async () => {
      const frontMcp = await FrontMcpInstance.createForGraph(serverConfig);
      const scope = frontMcp.getScopes()[0];

      const { clientTransport, close } = await createInMemoryServer(scope as any);

      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      // List tools
      const result = await client.listTools();

      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('create-note');
      expect(toolNames).toContain('list-notes');

      await client.close();
      await close();
    });

    it('should call tools via MCP client', async () => {
      const frontMcp = await FrontMcpInstance.createForGraph(serverConfig);
      const scope = frontMcp.getScopes()[0];

      const { clientTransport, close } = await createInMemoryServer(scope as any);

      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      // Call tool
      const result = await client.callTool({
        name: 'create-note',
        arguments: { title: 'MCP Client Note', content: 'Created via MCP client' },
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).not.toBe(true);

      await client.close();
      await close();
    });

    it('should update auth context dynamically', async () => {
      const frontMcp = await FrontMcpInstance.createForGraph(serverConfig);
      const scope = frontMcp.getScopes()[0];

      const { clientTransport, setAuthInfo, close } = await createInMemoryServer(scope as any, {
        authInfo: { token: 'initial-token' },
      });

      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      // Call with initial auth
      const result1 = await client.callTool({
        name: 'list-notes',
        arguments: {},
      });
      expect(result1.isError).not.toBe(true);

      // Update auth context
      setAuthInfo({ token: 'new-token', user: { sub: 'new-user' } } as any);

      // Call with updated auth
      const result2 = await client.callTool({
        name: 'list-notes',
        arguments: {},
      });
      expect(result2.isError).not.toBe(true);

      await client.close();
      await close();
    });

    it('should list resources via MCP client', async () => {
      const frontMcp = await FrontMcpInstance.createForGraph(serverConfig);
      const scope = frontMcp.getScopes()[0];

      const { clientTransport, close } = await createInMemoryServer(scope as any);

      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      const result = await client.listResources();

      expect(result.resources).toBeDefined();

      await client.close();
      await close();
    });

    it('should list prompts via MCP client', async () => {
      const frontMcp = await FrontMcpInstance.createForGraph(serverConfig);
      const scope = frontMcp.getScopes()[0];

      const { clientTransport, close } = await createInMemoryServer(scope as any);

      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      const result = await client.listPrompts();

      expect(result.prompts).toBeDefined();
      expect(result.prompts.length).toBeGreaterThan(0);

      await client.close();
      await close();
    });

    it('should get prompt via MCP client', async () => {
      const frontMcp = await FrontMcpInstance.createForGraph(serverConfig);
      const scope = frontMcp.getScopes()[0];

      const { clientTransport, close } = await createInMemoryServer(scope as any);

      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      const result = await client.getPrompt({
        name: 'summarize-notes',
        arguments: {},
      });

      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);

      await client.close();
      await close();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent tool calls via createDirect', async () => {
      const server = await FrontMcpInstance.createDirect(serverConfig);

      // Create multiple notes concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        server.callTool('create-note', {
          title: `Concurrent Note ${i}`,
          content: `Content ${i}`,
        }),
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result) => {
        expect(result.isError).not.toBe(true);
      });

      await server.dispose();
    });

    it('should handle concurrent operations via in-memory client', async () => {
      const frontMcp = await FrontMcpInstance.createForGraph(serverConfig);
      const scope = frontMcp.getScopes()[0];

      const { clientTransport, close } = await createInMemoryServer(scope as any);

      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      // Concurrent operations
      const [tools, resources, prompts] = await Promise.all([
        client.listTools(),
        client.listResources(),
        client.listPrompts(),
      ]);

      expect(tools.tools.length).toBeGreaterThan(0);
      expect(resources.resources).toBeDefined();
      expect(prompts.prompts.length).toBeGreaterThan(0);

      await client.close();
      await close();
    });
  });
});
