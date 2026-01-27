/**
 * E2E Tests for Connect Utilities
 *
 * Tests the connect() utilities for creating DirectClient connections:
 * - Multi-session support
 * - AuthToken injection
 * - Session recreation
 * - Multiple concurrent clients
 * - Capabilities preservation
 * - LLM-specific connect helpers (OpenAI, Claude, LangChain, Vercel AI)
 */

import { connect, connectOpenAI, connectClaude, connectLangChain, connectVercelAI, DirectClient } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';
import { notesStore } from '../src/apps/notes/data/notes.store';

/**
 * Helper to extract JSON result from raw MCP tool result.
 * Raw results are wrapped in { content: [{ type: 'text', text: '...' }] }
 */
function parseRawResult<T>(result: unknown): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = result as any;
  if (raw?.content?.[0]?.type === 'text') {
    return JSON.parse(raw.content[0].text) as T;
  }
  // Already parsed (e.g., from OpenAI platform)
  return result as T;
}

describe('Connect Utilities E2E', () => {
  beforeEach(() => {
    notesStore.clear();
  });

  describe('multi-session support', () => {
    it('should create independent sessions with different session IDs', async () => {
      const client1 = await connect(serverConfig, {
        session: { id: 'session-1', user: { sub: 'user-1' } },
      });
      const client2 = await connect(serverConfig, {
        session: { id: 'session-2', user: { sub: 'user-2' } },
      });

      try {
        expect(client1.getSessionId()).toBe('session-1');
        expect(client2.getSessionId()).toBe('session-2');
        expect(client1.getSessionId()).not.toBe(client2.getSessionId());
      } finally {
        await client1.close();
        await client2.close();
      }
    });

    it('should auto-generate unique session IDs when not provided', async () => {
      const client1 = await connect(serverConfig);
      const client2 = await connect(serverConfig);

      try {
        expect(client1.getSessionId()).toBeDefined();
        expect(client2.getSessionId()).toBeDefined();
        expect(client1.getSessionId()).toMatch(/^direct:/);
        expect(client2.getSessionId()).toMatch(/^direct:/);
        expect(client1.getSessionId()).not.toBe(client2.getSessionId());
      } finally {
        await client1.close();
        await client2.close();
      }
    });

    it('should allow custom session IDs', async () => {
      const customId = 'my-custom-session-123';
      const client = await connect(serverConfig, {
        session: { id: customId },
      });

      try {
        expect(client.getSessionId()).toBe(customId);
      } finally {
        await client.close();
      }
    });

    it('should isolate session data between clients', async () => {
      const client1 = await connect(serverConfig, {
        session: { id: 'isolated-1' },
      });
      const client2 = await connect(serverConfig, {
        session: { id: 'isolated-2' },
      });

      try {
        // Create note via client1
        await client1.callTool('create-note', {
          title: 'Client1 Note',
          content: 'From client 1',
        });

        // Both clients can see the note (notesStore is shared, as expected)
        // but their session IDs are isolated
        const authInfo1 = parseRawResult<{ sessionId: string }>(await client1.callTool('get-auth-info', {}));
        const authInfo2 = parseRawResult<{ sessionId: string }>(await client2.callTool('get-auth-info', {}));

        expect(authInfo1.sessionId).toBe('isolated-1');
        expect(authInfo2.sessionId).toBe('isolated-2');
      } finally {
        await client1.close();
        await client2.close();
      }
    });
  });

  describe('authToken injection', () => {
    it('should pass authToken to server context', async () => {
      const client = await connect(serverConfig, {
        authToken: 'test-jwt-token',
        session: { id: 'auth-test', user: { sub: 'user-123' } },
      });

      try {
        const result = parseRawResult<{
          hasToken: boolean;
          token: string;
          sessionId: string;
        }>(await client.callTool('get-auth-info', {}));

        expect(result.hasToken).toBe(true);
        expect(result.token).toBe('test-jwt-token');
        expect(result.sessionId).toBe('auth-test');
      } finally {
        await client.close();
      }
    });

    it('should make authToken available in tool execution', async () => {
      const client = await connect(serverConfig, {
        authToken: 'my-bearer-token',
        session: { id: 'token-test' },
      });

      try {
        const result = parseRawResult<{
          hasToken: boolean;
          token: string;
        }>(await client.callTool('get-auth-info', {}));

        expect(result.hasToken).toBe(true);
        expect(result.token).toBe('my-bearer-token');
      } finally {
        await client.close();
      }
    });

    it('should work without authToken (public mode)', async () => {
      const client = await connect(serverConfig, {
        session: { id: 'public-test' },
      });

      try {
        const result = parseRawResult<{
          hasToken: boolean;
          sessionId: string;
        }>(await client.callTool('get-auth-info', {}));

        expect(result.hasToken).toBe(false);
        expect(result.sessionId).toBe('public-test');
      } finally {
        await client.close();
      }
    });

    it('should pass user claims with authToken', async () => {
      const client = await connect(serverConfig, {
        authToken: 'jwt-with-claims',
        session: {
          id: 'claims-test',
          user: {
            sub: 'user-789',
            name: 'Test User',
            email: 'test@example.com',
          },
        },
      });

      try {
        const result = parseRawResult<{
          hasToken: boolean;
          userId: string;
          userName: string;
          userEmail: string;
        }>(await client.callTool('get-auth-info', {}));

        expect(result.hasToken).toBe(true);
        expect(result.userId).toBe('user-789');
        expect(result.userName).toBe('Test User');
        expect(result.userEmail).toBe('test@example.com');
      } finally {
        await client.close();
      }
    });
  });

  describe('session recreation', () => {
    it('should allow closing and reopening with same session ID', async () => {
      const sessionId = 'recreate-session';

      // First connection
      const client1 = await connect(serverConfig, {
        session: { id: sessionId },
      });

      // Create some data
      await client1.callTool('create-note', { title: 'Test', content: 'Content' });
      await client1.close();

      // Reconnect with same session ID
      const client2 = await connect(serverConfig, {
        session: { id: sessionId },
      });

      try {
        expect(client2.getSessionId()).toBe(sessionId);

        // Data persists in notesStore (not session-scoped)
        const notes = parseRawResult<{ notes: Array<{ title: string }>; count: number }>(
          await client2.callTool('list-notes', {}),
        );
        expect(notes.count).toBe(1);
        expect(notes.notes[0].title).toBe('Test');
      } finally {
        await client2.close();
      }
    });

    it('should maintain scope state across session recreation', async () => {
      const sessionId = 'scope-state-test';

      const client1 = await connect(serverConfig, {
        session: { id: sessionId },
      });

      // Get initial capabilities
      const caps1 = client1.getCapabilities();
      await client1.close();

      // Reconnect
      const client2 = await connect(serverConfig, {
        session: { id: sessionId },
      });

      try {
        const caps2 = client2.getCapabilities();

        // Capabilities should be consistent
        expect(caps2.tools).toEqual(caps1.tools);
        expect(caps2.prompts).toEqual(caps1.prompts);
        expect(caps2.resources).toEqual(caps1.resources);
      } finally {
        await client2.close();
      }
    });

    it('should properly cleanup resources on close', async () => {
      const client = await connect(serverConfig, {
        session: { id: 'cleanup-test' },
      });

      // Use the client
      await client.listTools();
      await client.callTool('list-notes', {});

      // Close should not throw
      await expect(client.close()).resolves.toBeUndefined();
    });

    it('should handle rapid session recreation', async () => {
      const sessionId = 'rapid-recreate';

      for (let i = 0; i < 5; i++) {
        const client = await connect(serverConfig, {
          session: { id: sessionId },
        });

        expect(client.getSessionId()).toBe(sessionId);

        // Quick operation
        await client.listTools();

        await client.close();
      }
    });
  });

  describe('multiple concurrent clients', () => {
    it('should support multiple clients connecting simultaneously', async () => {
      const clients: DirectClient[] = [];

      try {
        // Create 5 concurrent clients
        const createPromises = Array.from({ length: 5 }, (_, i) =>
          connect(serverConfig, {
            session: { id: `concurrent-${i}`, user: { sub: `user-${i}` } },
          }),
        );

        clients.push(...(await Promise.all(createPromises)));

        // Verify all have unique sessions
        const sessionIds = clients.map((c) => c.getSessionId());
        expect(new Set(sessionIds).size).toBe(5);

        // Verify expected session IDs
        for (let i = 0; i < 5; i++) {
          expect(sessionIds).toContain(`concurrent-${i}`);
        }
      } finally {
        await Promise.all(clients.map((c) => c.close()));
      }
    });

    it('should isolate requests between concurrent clients', async () => {
      const clients: DirectClient[] = [];

      try {
        // Create clients with different user IDs
        clients.push(
          await connect(serverConfig, {
            session: { id: 'concurrent-a', user: { sub: 'user-a' } },
          }),
          await connect(serverConfig, {
            session: { id: 'concurrent-b', user: { sub: 'user-b' } },
          }),
        );

        // Concurrent auth info requests
        const rawResults = await Promise.all(clients.map((c) => c.callTool('get-auth-info', {})));
        const results = rawResults.map((r) => parseRawResult<{ sessionId: string; userId: string }>(r));

        expect(results[0].sessionId).toBe('concurrent-a');
        expect(results[0].userId).toBe('user-a');
        expect(results[1].sessionId).toBe('concurrent-b');
        expect(results[1].userId).toBe('user-b');
      } finally {
        await Promise.all(clients.map((c) => c.close()));
      }
    });

    it('should handle concurrent tool calls from different clients', async () => {
      const clients: DirectClient[] = [];

      try {
        // Create 3 clients
        for (let i = 0; i < 3; i++) {
          clients.push(
            await connect(serverConfig, {
              session: { id: `tool-client-${i}` },
            }),
          );
        }

        // Each client creates a note concurrently
        const createPromises = clients.map((c, i) =>
          c.callTool('create-note', {
            title: `Note from client ${i}`,
            content: `Content ${i}`,
          }),
        );

        const results = await Promise.all(createPromises);

        // All should succeed
        results.forEach((result) => {
          expect(result).toBeDefined();
        });

        // Verify all notes were created
        const notes = parseRawResult<{ count: number }>(await clients[0].callTool('list-notes', {}));
        expect(notes.count).toBe(3);
      } finally {
        await Promise.all(clients.map((c) => c.close()));
      }
    });

    it('should properly cleanup all clients', async () => {
      const clients: DirectClient[] = [];

      // Create clients
      for (let i = 0; i < 3; i++) {
        clients.push(
          await connect(serverConfig, {
            session: { id: `cleanup-client-${i}` },
          }),
        );
      }

      // Close all concurrently
      await Promise.all(clients.map((c) => c.close()));

      // All should be closed (no errors on cleanup)
    });
  });

  describe('capabilities', () => {
    it('should return server capabilities after connection', async () => {
      const client = await connect(serverConfig);

      try {
        const capabilities = client.getCapabilities();

        expect(capabilities).toBeDefined();
        expect(capabilities.tools).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should preserve capabilities across operations', async () => {
      const client = await connect(serverConfig);

      try {
        const capsBefore = client.getCapabilities();

        // Perform various operations
        await client.listTools();
        await client.callTool('list-notes', {});
        await client.listResources();
        await client.listPrompts();

        const capsAfter = client.getCapabilities();

        // Capabilities should remain unchanged
        expect(capsAfter).toEqual(capsBefore);
      } finally {
        await client.close();
      }
    });

    it('should reflect actual server capabilities (tools, resources, prompts)', async () => {
      const client = await connect(serverConfig);

      try {
        const capabilities = client.getCapabilities();

        // Verify capabilities match actual server features
        const tools = (await client.listTools()) as Array<{ name: string }>;
        const resources = await client.listResources();
        const prompts = await client.listPrompts();

        // Server has tools
        expect(capabilities.tools).toBeDefined();
        expect(tools.length).toBeGreaterThan(0);

        // Server has resources
        expect(capabilities.resources).toBeDefined();
        expect(resources.resources.length).toBeGreaterThanOrEqual(0);

        // Server has prompts
        expect(capabilities.prompts).toBeDefined();
        expect(prompts.prompts.length).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    });

    it('should support capability override in options', async () => {
      const client = await connect(serverConfig, {
        capabilities: {
          roots: { listChanged: true },
        },
      });

      try {
        // Client should connect successfully with custom capabilities
        expect(client.getCapabilities()).toBeDefined();
        expect(client.getClientInfo()).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should return server info after connection', async () => {
      const client = await connect(serverConfig);

      try {
        const serverInfo = client.getServerInfo();

        expect(serverInfo).toBeDefined();
        expect(serverInfo.name).toBe('Demo E2E Direct');
        expect(serverInfo.version).toBe('0.1.0');
      } finally {
        await client.close();
      }
    });
  });

  describe('LLM-specific connect helpers', () => {
    describe('connectOpenAI', () => {
      it('should detect OpenAI platform', async () => {
        const client = await connectOpenAI(serverConfig);

        try {
          expect(client.getDetectedPlatform()).toBe('openai');
          expect(client.getClientInfo().name).toBe('openai');
        } finally {
          await client.close();
        }
      });

      it('should format tools correctly for OpenAI', async () => {
        const client = await connectOpenAI(serverConfig);

        try {
          const tools = (await client.listTools()) as Array<{
            type: string;
            function: { name: string; description: string; parameters: unknown; strict: boolean };
          }>;

          expect(tools.length).toBeGreaterThan(0);

          // Verify OpenAI format
          const tool = tools[0];
          expect(tool).toHaveProperty('type', 'function');
          expect(tool).toHaveProperty('function');
          expect(tool.function).toHaveProperty('name');
          expect(tool.function).toHaveProperty('parameters');
          expect(tool.function).toHaveProperty('strict', true);
        } finally {
          await client.close();
        }
      });

      it('should format tool results for OpenAI', async () => {
        const client = await connectOpenAI(serverConfig);

        try {
          const result = await client.callTool('list-notes', {});

          // OpenAI expects simple JSON-parsed result
          expect(result).toBeDefined();
          expect(typeof result).toBe('object');
        } finally {
          await client.close();
        }
      });
    });

    describe('connectClaude', () => {
      it('should detect Claude platform', async () => {
        const client = await connectClaude(serverConfig);

        try {
          expect(client.getDetectedPlatform()).toBe('claude');
          expect(client.getClientInfo().name).toBe('claude');
        } finally {
          await client.close();
        }
      });

      it('should format tools correctly for Claude', async () => {
        const client = await connectClaude(serverConfig);

        try {
          const tools = (await client.listTools()) as Array<{
            name: string;
            description: string;
            input_schema: Record<string, unknown>;
          }>;

          expect(tools.length).toBeGreaterThan(0);

          // Verify Claude format
          const tool = tools[0];
          expect(tool).toHaveProperty('name');
          expect(tool).toHaveProperty('input_schema');
          expect(tool).not.toHaveProperty('type'); // No 'type' field in Claude format
          expect(tool).not.toHaveProperty('function'); // No wrapper
        } finally {
          await client.close();
        }
      });

      it('should format tool results for Claude', async () => {
        const client = await connectClaude(serverConfig);

        try {
          const result = await client.callTool('list-notes', {});

          // Claude gets content array directly
          expect(result).toBeDefined();
          expect(Array.isArray(result)).toBe(true);
        } finally {
          await client.close();
        }
      });
    });

    describe('connectLangChain', () => {
      it('should detect LangChain platform', async () => {
        const client = await connectLangChain(serverConfig);

        try {
          expect(client.getDetectedPlatform()).toBe('langchain');
          expect(client.getClientInfo().name).toBe('langchain');
        } finally {
          await client.close();
        }
      });

      it('should format tools correctly for LangChain', async () => {
        const client = await connectLangChain(serverConfig);

        try {
          const tools = (await client.listTools()) as Array<{
            name: string;
            description: string;
            schema: Record<string, unknown>;
          }>;

          expect(tools.length).toBeGreaterThan(0);

          // Verify LangChain format
          const tool = tools[0];
          expect(tool).toHaveProperty('name');
          expect(tool).toHaveProperty('description');
          expect(tool).toHaveProperty('schema');
          expect(tool).not.toHaveProperty('input_schema'); // Different from Claude
        } finally {
          await client.close();
        }
      });
    });

    describe('connectVercelAI', () => {
      it('should detect Vercel AI platform', async () => {
        const client = await connectVercelAI(serverConfig);

        try {
          expect(client.getDetectedPlatform()).toBe('vercel-ai');
          expect(client.getClientInfo().name).toBe('vercel-ai');
        } finally {
          await client.close();
        }
      });

      it('should format tools correctly for Vercel AI SDK', async () => {
        const client = await connectVercelAI(serverConfig);

        try {
          const tools = (await client.listTools()) as Record<string, { description: string; parameters: unknown }>;

          // Verify Vercel AI format (object map, not array)
          expect(typeof tools).toBe('object');
          expect(Array.isArray(tools)).toBe(false);

          // Should have tool names as keys
          const toolNames = Object.keys(tools);
          expect(toolNames.length).toBeGreaterThan(0);
          expect(toolNames).toContain('list-notes');

          // Verify structure
          const listNotesTool = tools['list-notes'];
          expect(listNotesTool).toHaveProperty('description');
          expect(listNotesTool).toHaveProperty('parameters');
        } finally {
          await client.close();
        }
      });

      it('should format tool results for Vercel AI SDK', async () => {
        const client = await connectVercelAI(serverConfig);

        try {
          const result = await client.callTool('list-notes', {});

          // Vercel AI gets structured data
          expect(result).toBeDefined();
          expect(typeof result).toBe('object');
        } finally {
          await client.close();
        }
      });
    });

    describe('raw platform (default)', () => {
      it('should use raw platform for generic client info', async () => {
        const client = await connect(serverConfig, {
          clientInfo: { name: 'my-custom-agent', version: '2.0.0' },
        });

        try {
          expect(client.getDetectedPlatform()).toBe('raw');
          expect(client.getClientInfo().name).toBe('my-custom-agent');
          expect(client.getClientInfo().version).toBe('2.0.0');
        } finally {
          await client.close();
        }
      });

      it('should return raw MCP format for tools', async () => {
        const client = await connect(serverConfig, {
          clientInfo: { name: 'generic-client', version: '1.0.0' },
        });

        try {
          const tools = (await client.listTools()) as Array<{
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
          }>;

          expect(tools.length).toBeGreaterThan(0);

          // Verify raw MCP format
          const tool = tools[0];
          expect(tool).toHaveProperty('name');
          expect(tool).toHaveProperty('inputSchema'); // MCP uses inputSchema, not parameters
        } finally {
          await client.close();
        }
      });
    });

    describe('platform detection heuristics', () => {
      it('should detect OpenAI from client name containing "gpt"', async () => {
        const client = await connect(serverConfig, {
          clientInfo: { name: 'my-gpt-agent', version: '1.0.0' },
        });

        try {
          expect(client.getDetectedPlatform()).toBe('openai');
        } finally {
          await client.close();
        }
      });

      it('should detect Claude from client name containing "anthropic"', async () => {
        const client = await connect(serverConfig, {
          clientInfo: { name: 'anthropic-assistant', version: '1.0.0' },
        });

        try {
          expect(client.getDetectedPlatform()).toBe('claude');
        } finally {
          await client.close();
        }
      });

      it('should detect Vercel AI from client name containing "ai-sdk"', async () => {
        const client = await connect(serverConfig, {
          clientInfo: { name: 'my-ai-sdk-app', version: '1.0.0' },
        });

        try {
          expect(client.getDetectedPlatform()).toBe('vercel-ai');
        } finally {
          await client.close();
        }
      });
    });
  });

  describe('error handling', () => {
    it('should handle tool call errors gracefully', async () => {
      const client = await connect(serverConfig);

      try {
        // Call non-existent tool - MCP SDK may return isError instead of throwing
        const result = (await client.callTool('non-existent-tool', {})) as { isError?: boolean };
        expect(result.isError).toBe(true);
      } finally {
        await client.close();
      }
    });

    it('should handle invalid resource URI', async () => {
      const client = await connect(serverConfig);

      try {
        await expect(client.readResource('invalid://not-found')).rejects.toThrow();
      } finally {
        await client.close();
      }
    });

    it('should handle invalid prompt name', async () => {
      const client = await connect(serverConfig);

      try {
        await expect(client.getPrompt('non-existent-prompt', {})).rejects.toThrow();
      } finally {
        await client.close();
      }
    });
  });

  describe('full workflow integration', () => {
    it('should support complete workflow: connect, operate, close', async () => {
      // Connect with auth - using OpenAI platform for parsed results
      const client = await connectOpenAI(serverConfig, {
        authToken: 'workflow-token',
        session: { id: 'workflow-session', user: { sub: 'workflow-user' } },
      });

      try {
        // Verify connection
        expect(client.getSessionId()).toBe('workflow-session');
        expect(client.getDetectedPlatform()).toBe('openai');

        // List tools
        const tools = await client.listTools();
        expect(Array.isArray(tools)).toBe(true);

        // Create note
        await client.callTool('create-note', {
          title: 'Workflow Note',
          content: 'Integration test content',
        });

        // List notes - OpenAI platform parses JSON automatically
        const notes = (await client.callTool('list-notes', {})) as { count: number };
        expect(notes.count).toBe(1);

        // Read resource
        const resource = await client.readResource('notes://all');
        expect(resource.contents).toBeDefined();

        // Get prompt
        const prompt = await client.getPrompt('summarize-notes', { format: 'brief' });
        expect(prompt.messages).toBeDefined();
      } finally {
        // Close cleanly
        await client.close();
      }
    });
  });
});
