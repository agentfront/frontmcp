/**
 * E2E Tests for Unix Socket Transport
 *
 * Tests the FrontMcpInstance.runUnixSocket() API for Unix socket transport.
 * Verifies the full MCP request lifecycle over Unix domain sockets.
 */

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FrontMcpInstance } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';
import { notesStore } from '../src/apps/notes/data/notes.store';
import { httpOverSocket, UnixSocketMcpClient } from './helpers/unix-socket-client';

/**
 * Generate a unique socket path in os.tmpdir().
 * Uses a short prefix + randomUUID to stay within macOS 104-byte limit.
 */
function uniqueSocketPath(): string {
  return path.join(os.tmpdir(), `mcp-${randomUUID().slice(0, 8)}.sock`);
}

/**
 * Wait for the server to be ready by polling the health endpoint.
 * This ensures the listen callback has completed (including chmod).
 */
async function waitForSocket(socketPath: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!fs.existsSync(socketPath)) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    // Socket file exists - try to hit the health endpoint to confirm readiness
    try {
      const response = await httpOverSocket(socketPath, { path: '/health' });
      if (response.statusCode === 200) return;
    } catch {
      // Connection refused - server not ready yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Server not ready within ${timeoutMs}ms: ${socketPath}`);
}

/**
 * Try to clean up a socket file, ignoring errors.
 */
function cleanupSocket(socketPath: string): void {
  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch {
    // Ignore cleanup errors
  }
}

describe('Unix Socket Transport E2E', () => {
  let socketPath: string;
  let handle: { close: () => Promise<void> } | null = null;

  beforeEach(() => {
    socketPath = uniqueSocketPath();
    notesStore.clear();
  });

  afterEach(async () => {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Ignore close errors
      }
      handle = null;
    }
    cleanupSocket(socketPath);
  });

  /**
   * Helper: start the server and wait until the socket is ready.
   */
  async function startServer(overrides?: Record<string, unknown>): Promise<void> {
    handle = await FrontMcpInstance.runUnixSocket({
      ...serverConfig,
      ...overrides,
      socketPath,
    });
    await waitForSocket(socketPath);
  }

  // ─── Socket Lifecycle ──────────────────────────────────────────────────────

  describe('Socket Lifecycle', () => {
    it('should create socket file on startup', async () => {
      await startServer();

      expect(fs.existsSync(socketPath)).toBe(true);
    });

    it('should set socket file permissions to 0o660', async () => {
      await startServer();

      const stats = fs.statSync(socketPath);
      // Extract permission bits (last 9 bits)
      const perms = stats.mode & 0o777;
      expect(perms).toBe(0o660);
    });

    it('should clean up socket file on close', async () => {
      await startServer();
      expect(fs.existsSync(socketPath)).toBe(true);

      if (!handle) throw new Error('Expected handle to be defined after startServer()');
      await handle.close();
      handle = null;

      expect(fs.existsSync(socketPath)).toBe(false);
    });

    it('should handle stale socket file on restart', async () => {
      // Create a stale socket file
      fs.writeFileSync(socketPath, '');
      expect(fs.existsSync(socketPath)).toBe(true);

      // Starting should clean up the stale file and proceed
      await startServer();

      expect(fs.existsSync(socketPath)).toBe(true);
      // Verify the server is actually functional
      const response = await httpOverSocket(socketPath, { path: '/health' });
      expect(response.statusCode).toBe(200);
    });
  });

  // ─── Health Endpoint ───────────────────────────────────────────────────────

  describe('Health Endpoint', () => {
    it('should return status ok from GET /health', async () => {
      await startServer();

      const response = await httpOverSocket(socketPath, {
        method: 'GET',
        path: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ status: 'ok' });
    });
  });

  // ─── MCP Protocol ─────────────────────────────────────────────────────────

  describe('MCP Protocol', () => {
    it('should complete initialize handshake', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      const result = await client.initialize();

      expect(result.result).toBeDefined();

      const initResult = result.result as Record<string, unknown>;
      expect(initResult['protocolVersion']).toBeDefined();
      expect(initResult['serverInfo']).toBeDefined();
      expect(initResult['capabilities']).toBeDefined();

      const serverInfo = initResult['serverInfo'] as Record<string, unknown>;
      expect(serverInfo['name']).toBe('Demo E2E Unix Socket');
    });

    it('should assign a session ID on initialization', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      const sessionId = client.getSessionId();
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      if (!sessionId) throw new Error('Expected sessionId to be defined');
      expect(sessionId.length).toBeGreaterThan(0);
    });
  });

  // ─── Tool Operations ──────────────────────────────────────────────────────

  describe('Tool Operations', () => {
    it('should list tools', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      const result = await client.request('tools/list', {});

      expect(result.result).toBeDefined();
      const listResult = result.result as { tools: Array<{ name: string }> };
      const toolNames = listResult.tools.map((t) => t.name);
      expect(toolNames).toContain('create-note');
      expect(toolNames).toContain('list-notes');
    });

    it('should call create-note tool', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      const result = await client.request('tools/call', {
        name: 'create-note',
        arguments: { title: 'Socket Note', content: 'Created via Unix socket' },
      });

      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();

      const callResult = result.result as { content: Array<{ type: string; text: string }> };
      expect(callResult.content).toBeDefined();
      expect(callResult.content.length).toBeGreaterThan(0);

      const textContent = callResult.content.find((c) => c.type === 'text');
      if (!textContent) throw new Error('Expected text content in create-note response');
      const parsed = JSON.parse(textContent.text);
      expect(parsed.title).toBe('Socket Note');
      expect(parsed.content).toBe('Created via Unix socket');
      expect(parsed.id).toMatch(/^note-/);
    });

    it('should call list-notes and reflect created notes', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      // Create a note first
      await client.request('tools/call', {
        name: 'create-note',
        arguments: { title: 'Note 1', content: 'Content 1' },
      });

      // List notes
      const result = await client.request('tools/call', {
        name: 'list-notes',
        arguments: {},
      });

      expect(result.error).toBeUndefined();
      const callResult = result.result as { content: Array<{ type: string; text: string }> };
      const textContent = callResult.content.find((c) => c.type === 'text');
      if (!textContent) throw new Error('Expected text content in list-notes response');
      const parsed = JSON.parse(textContent.text);
      expect(parsed.count).toBe(1);
      expect(parsed.notes).toHaveLength(1);
      expect(parsed.notes[0].title).toBe('Note 1');
    });
  });

  // ─── Resource Operations ───────────────────────────────────────────────────

  describe('Resource Operations', () => {
    it('should list resources', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      const result = await client.request('resources/list', {});

      expect(result.result).toBeDefined();
      const listResult = result.result as { resources: Array<{ uri: string; name: string }> };
      expect(listResult.resources).toBeDefined();
    });

    it('should read notes://all resource', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      // Create a note so resource has data
      await client.request('tools/call', {
        name: 'create-note',
        arguments: { title: 'Resource Note', content: 'For resource test' },
      });

      const result = await client.request('resources/read', {
        uri: 'notes://all',
      });

      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();
      const readResult = result.result as { contents: Array<{ text: string }> };
      expect(readResult.contents).toBeDefined();
      expect(readResult.contents.length).toBeGreaterThan(0);
    });
  });

  // ─── Prompt Operations ─────────────────────────────────────────────────────

  describe('Prompt Operations', () => {
    it('should list prompts', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      const result = await client.request('prompts/list', {});

      expect(result.result).toBeDefined();
      const listResult = result.result as { prompts: Array<{ name: string }> };
      expect(listResult.prompts.length).toBeGreaterThan(0);

      const promptNames = listResult.prompts.map((p) => p.name);
      expect(promptNames).toContain('summarize-notes');
    });

    it('should get prompt without arguments', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      const result = await client.request('prompts/get', {
        name: 'summarize-notes',
      });

      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();
      const getResult = result.result as { messages: Array<{ role: string }> };
      expect(getResult.messages).toBeDefined();
      expect(getResult.messages.length).toBeGreaterThan(0);
    });

    it('should get prompt with arguments', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      const result = await client.request('prompts/get', {
        name: 'summarize-notes',
        arguments: { format: 'detailed' },
      });

      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();
      const getResult = result.result as { messages: Array<{ role: string }>; description: string };
      expect(getResult.messages.length).toBeGreaterThan(0);
      expect(getResult.description).toContain('detailed');
    });
  });

  // ─── Session Persistence ───────────────────────────────────────────────────

  describe('Session Persistence', () => {
    it('should maintain stable session ID across multiple requests', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      const sessionId1 = client.getSessionId();
      expect(sessionId1).toBeDefined();

      // Make several more requests
      await client.request('tools/list', {});
      const sessionId2 = client.getSessionId();

      await client.request('resources/list', {});
      const sessionId3 = client.getSessionId();

      await client.request('prompts/list', {});
      const sessionId4 = client.getSessionId();

      // Session ID should remain the same
      expect(sessionId2).toBe(sessionId1);
      expect(sessionId3).toBe(sessionId1);
      expect(sessionId4).toBe(sessionId1);
    });
  });

  // ─── Concurrent Operations ─────────────────────────────────────────────────

  describe('Concurrent Operations', () => {
    it('should handle parallel list requests', async () => {
      await startServer();

      const client = new UnixSocketMcpClient(socketPath);
      await client.initialize();

      // Fire multiple list requests in parallel
      const [tools, resources, prompts] = await Promise.all([
        client.request('tools/list', {}),
        client.request('resources/list', {}),
        client.request('prompts/list', {}),
      ]);

      expect(tools.result).toBeDefined();
      expect(resources.result).toBeDefined();
      expect(prompts.result).toBeDefined();

      const toolList = tools.result as { tools: unknown[] };
      const promptList = prompts.result as { prompts: unknown[] };
      expect(toolList.tools.length).toBeGreaterThan(0);
      expect(promptList.prompts.length).toBeGreaterThan(0);
    });
  });
});
