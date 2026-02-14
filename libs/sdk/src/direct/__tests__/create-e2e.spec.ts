/**
 * create() E2E Tests
 *
 * Non-mocked integration tests exercising real create() → connect() → tool calls.
 */

import 'reflect-metadata';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Tool, ToolContext } from '../../common';
import type { DirectMcpServer } from '../direct.types';
import type { DirectClient } from '../client.types';

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const echoInput = z.object({ message: z.string() });

@Tool({ name: 'echo', description: 'Echoes the message', inputSchema: echoInput })
class EchoTool extends ToolContext<typeof echoInput> {
  async execute(input: z.infer<typeof echoInput>): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: `Echo: ${input.message}` }] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create() E2E', () => {
  let server: DirectMcpServer | undefined;
  const clients: DirectClient[] = [];

  afterEach(async () => {
    // Close all clients
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // best-effort
      }
    }
    clients.length = 0;

    // Dispose server
    if (server) {
      try {
        await server.dispose();
      } catch {
        // best-effort
      }
      server = undefined;
    }

    // Reset caches and machine ID override
    const { clearCreateCache } = await import('../create');
    const { setMachineIdOverride } = await import('@frontmcp/auth');
    clearCreateCache();
    setMachineIdOverride(undefined);
  });

  /**
   * Helper to create a server with default config.
   */
  async function createServer(overrides?: Record<string, unknown>): Promise<DirectMcpServer> {
    const { create } = await import('../create');
    server = await create({
      info: { name: 'e2e-test', version: '1.0.0' },
      tools: [EchoTool],
      machineId: 'e2e-stable-id',
      ...overrides,
    });
    return server;
  }

  /**
   * Helper to track a client for cleanup.
   */
  function track(client: DirectClient): DirectClient {
    clients.push(client);
    return client;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Basic create + listTools + callTool
  // ─────────────────────────────────────────────────────────────────────

  it('should create server, list tools, and call a tool', async () => {
    const srv = await createServer();

    const { tools } = await srv.listTools();
    const echoTool = tools.find((t) => t.name === 'echo');
    expect(echoTool).toBeDefined();
    if (!echoTool) throw new Error('echoTool not found');
    expect(echoTool.description).toBe('Echoes the message');

    const result = await srv.callTool('echo', { message: 'hello' });
    expect(result.content).toEqual([{ type: 'text', text: 'Echo: hello' }]);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Multi-client connectivity via connect()
  // ─────────────────────────────────────────────────────────────────────

  it('should support multiple clients via connect()', async () => {
    const srv = await createServer();

    const client1 = track(await srv.connect({ session: { id: 'user-1' } }));
    const client2 = track(await srv.connect('user-2'));

    // Both clients can list tools
    const tools1 = await client1.listTools();
    const tools2 = await client2.listTools();
    expect(Array.isArray(tools1)).toBe(true);
    expect(Array.isArray(tools2)).toBe(true);

    // Both clients can call tools independently
    const result1 = await client1.callTool('echo', { message: 'from-1' });
    const result2 = await client2.callTool('echo', { message: 'from-2' });

    // DirectClient returns FormattedToolResult (raw platform returns CallToolResult-like)
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Session isolation between clients
  // ─────────────────────────────────────────────────────────────────────

  it('should give each client a distinct session ID', async () => {
    const srv = await createServer();

    const client1 = track(await srv.connect({ session: { id: 'session-a' } }));
    const client2 = track(await srv.connect('session-b'));

    expect(client1.getSessionId()).toBe('session-a');
    expect(client2.getSessionId()).toBe('session-b');
    expect(client1.getSessionId()).not.toBe(client2.getSessionId());
  });

  // ─────────────────────────────────────────────────────────────────────
  // Server lifecycle: dispose → recreate
  // ─────────────────────────────────────────────────────────────────────

  it('should support dispose and recreate with stable machineId', async () => {
    const { create } = await import('../create');
    const { getMachineId } = await import('@frontmcp/auth');

    // Create first server
    const srv1 = await create({
      info: { name: 'lifecycle-test', version: '1.0.0' },
      tools: [EchoTool],
      machineId: 'lifecycle-stable-id',
    });

    const client1 = track(await srv1.connect('s1'));
    const result1 = await client1.callTool('echo', { message: 'first' });
    expect(result1).toBeDefined();
    const machineId1 = getMachineId();
    expect(machineId1).toBe('lifecycle-stable-id');

    await client1.close();
    clients.length = 0; // Already closed
    await srv1.dispose();

    // Create second server with same machineId
    server = await create({
      info: { name: 'lifecycle-test', version: '1.0.0' },
      tools: [EchoTool],
      machineId: 'lifecycle-stable-id',
    });

    const client2 = track(await server.connect('s2'));
    const result2 = await client2.callTool('echo', { message: 'second' });
    expect(result2).toBeDefined();
    expect(getMachineId()).toBe('lifecycle-stable-id');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Invalid redis config rejection
  // ─────────────────────────────────────────────────────────────────────

  it('should reject invalid redis config', async () => {
    const { create } = await import('../create');

    await expect(
      create({
        info: { name: 'redis-test', version: '1.0.0' },
        tools: [EchoTool],
        // Missing required 'host' field for redis provider
        redis: { provider: 'redis' } as never,
      }),
    ).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Disposed server rejects operations
  // ─────────────────────────────────────────────────────────────────────

  it('should reject connect() after dispose', async () => {
    const srv = await createServer();
    await srv.dispose();
    server = undefined; // Already disposed

    await expect(srv.connect()).rejects.toThrow(/disposed/i);
  });

  it('should reject callTool() after dispose', async () => {
    const srv = await createServer();
    await srv.dispose();
    server = undefined; // Already disposed

    await expect(srv.callTool('echo', { message: 'fail' })).rejects.toThrow(/disposed/i);
  });
});
