/**
 * E2E Tests for Stdio Transport
 *
 * Tests the FrontMcpInstance.runStdio() API for stdio transport support.
 * This enables integration with Claude Desktop, Claude Code, and other
 * MCP clients that communicate via stdin/stdout.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'path';

describe('Stdio Transport E2E', () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  // Path to the stdio entrypoint
  const entrypointPath = join(__dirname, '../src/stdio-entrypoint.ts');
  const projectPath = join(__dirname, '..');

  afterEach(async () => {
    // Cleanup client first
    if (client) {
      try {
        await client.close();
      } catch (err) {
        // Log but don't fail test - cleanup errors are often non-critical
        console.debug('Client cleanup warning:', err);
      }
      client = null;
    }

    // Cleanup transport (this kills the spawned process)
    if (transport) {
      try {
        await transport.close();
      } catch (err) {
        // Log but don't fail test - process may have already exited
        console.debug('Transport cleanup warning:', err);
      }
      transport = null;
    }

    // Give process time to cleanup
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  async function startServerAndConnect(): Promise<void> {
    // Use StdioClientTransport which spawns the process itself
    // We use tsx for better ESM support
    transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', entrypointPath],
      env: process.env as Record<string, string>,
      cwd: projectPath,
    });

    // Create and connect MCP client
    client = new Client({ name: 'stdio-test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }

  it('should connect to stdio server and list tools', async () => {
    await startServerAndConnect();

    const result = await client!.listTools();

    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThan(0);

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('create-note');
    expect(toolNames).toContain('list-notes');
  }, 30000);

  it('should call tools via stdio transport', async () => {
    await startServerAndConnect();

    // Create a note
    const createResult = await client!.callTool({
      name: 'create-note',
      arguments: { title: 'Stdio Test Note', content: 'Created via stdio transport' },
    });

    expect(createResult).toBeDefined();
    expect(createResult.isError).not.toBe(true);
    // Validate response structure
    expect(createResult.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]));

    // List notes
    const listResult = await client!.callTool({
      name: 'list-notes',
      arguments: {},
    });

    expect(listResult).toBeDefined();
    expect(listResult.isError).not.toBe(true);
    // Validate response structure
    expect(listResult.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]));
  }, 30000);

  it('should list resources via stdio transport', async () => {
    await startServerAndConnect();

    const result = await client!.listResources();

    expect(result.resources).toBeDefined();
  }, 30000);

  it('should list prompts via stdio transport', async () => {
    await startServerAndConnect();

    const result = await client!.listPrompts();

    expect(result.prompts).toBeDefined();
    expect(result.prompts.length).toBeGreaterThan(0);
  }, 30000);
});
