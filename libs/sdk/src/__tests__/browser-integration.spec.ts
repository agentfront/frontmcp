/**
 * Browser Integration Tests
 *
 * Tests that the browser entry point exports work correctly together.
 * These tests run in Node.js but validate the browser-compatible code paths.
 *
 * Tests:
 * - BrowserContextStorage works as a drop-in for AsyncLocalStorage
 * - create() → server with tools → listTools → callTool
 * - Context storage interface compliance
 */

import 'reflect-metadata';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Tool, ToolContext } from '../common';
import { BrowserContextStorage } from '../context/context-storage.browser';
import type { IContextStorage } from '../context/context-storage.interface';
import type { DirectMcpServer } from '../direct/direct.types';
import { clearCreateCache } from '../direct/create';

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const greetInput = z.object({ name: z.string() });

@Tool({ name: 'greet', description: 'Greets by name', inputSchema: greetInput })
class GreetTool extends ToolContext<typeof greetInput> {
  async execute(input: z.infer<typeof greetInput>): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: `Hello, ${input.name}!` }] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BrowserContextStorage Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BrowserContextStorage integration', () => {
  it('should conform to IContextStorage interface', () => {
    const storage: IContextStorage<{ value: string }> = new BrowserContextStorage();
    expect(storage.getStore()).toBeUndefined();

    const result = storage.run({ value: 'test' }, () => {
      return storage.getStore()?.value;
    });

    expect(result).toBe('test');
    expect(storage.getStore()).toBeUndefined();
  });

  it('should handle sequential async runs', async () => {
    const storage = new BrowserContextStorage<number>();

    const r1 = await storage.run(1, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return storage.getStore();
    });

    const r2 = await storage.run(2, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return storage.getStore();
    });

    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(storage.getStore()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Direct Server Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Browser-compatible direct server', () => {
  let server: DirectMcpServer | undefined;

  afterEach(async () => {
    if (server) {
      try {
        await server.dispose();
      } catch {
        // best-effort
      }
      server = undefined;
    }
    clearCreateCache();
    const { setMachineIdOverride } = await import('@frontmcp/auth');
    setMachineIdOverride(undefined);
  });

  it('should create server and list/call tools', async () => {
    const { create } = await import('../direct/create');

    server = await create({
      info: { name: 'browser-test-server', version: '1.0.0' },
      tools: [GreetTool],
      machineId: 'browser-test-machine',
    });

    // List tools via DirectMcpServer
    const { tools } = await server.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(1);

    const greetTool = tools.find((t) => t.name === 'greet');
    expect(greetTool).toBeDefined();
    expect(greetTool?.description).toBe('Greets by name');

    // Call tool via DirectMcpServer
    const result = await server.callTool('greet', { name: 'Browser' });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    const textContent = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text');
    expect(textContent?.text).toBe('Hello, Browser!');
  });

  it('should handle tool errors gracefully', async () => {
    const failInput = z.object({});

    @Tool({ name: 'fail_tool', description: 'Always fails', inputSchema: failInput })
    class FailTool extends ToolContext<typeof failInput> {
      async execute(): Promise<CallToolResult> {
        throw new Error('Intentional failure');
      }
    }

    const { create } = await import('../direct/create');

    server = await create({
      info: { name: 'error-test-server', version: '1.0.0' },
      tools: [FailTool],
      machineId: 'browser-error-test-machine',
    });

    // DirectMcpServer.callTool wraps execution errors in ToolExecutionError
    await expect(server.callTool('fail_tool', {})).rejects.toThrow('Intentional failure');
  });
});
