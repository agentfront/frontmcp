/**
 * E2E tests for the CLI `serve` command.
 *
 * Verifies that `node cli-bundle.js serve --port <port>` starts an HTTP server
 * that serves the full MCP protocol (initialize, tools, resources, prompts).
 */

import { ChildProcess } from 'child_process';
import { ensureBuild, getCliBundlePath, spawnServer } from './helpers/exec-cli';
import { McpJsonRpcClient, waitForPort } from './helpers/mcp-client';

const TEST_PORT = 50451;

function killQuiet(proc: ChildProcess | null): void {
  try {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

describe('CLI Serve Command E2E', () => {
  let serverProc: ChildProcess | null = null;

  beforeAll(async () => {
    await ensureBuild();
  });

  afterEach(async () => {
    killQuiet(serverProc);
    serverProc = null;
    // Give port time to release
    await new Promise((r) => setTimeout(r, 500));
  });

  function startServe(port: number): ChildProcess {
    const proc = spawnServer(['node', getCliBundlePath(), 'serve', '--port', String(port)]);
    serverProc = proc;
    return proc;
  }

  it('should start HTTP server and respond to health check', async () => {
    startServe(TEST_PORT);
    await waitForPort(TEST_PORT, 20_000);
    // If waitForPort didn't throw, the server is healthy
  });

  it('should handle MCP initialize handshake', async () => {
    startServe(TEST_PORT);
    await waitForPort(TEST_PORT, 20_000);

    const client = McpJsonRpcClient.forPort(TEST_PORT, '/');
    const result = await client.initialize();

    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(client.getSessionId()).toBeDefined();

    const initResult = result.result as Record<string, unknown>;
    expect(initResult['protocolVersion']).toBeDefined();
    expect(initResult['capabilities']).toBeDefined();
  });

  it('should list tools with expected fixture tools', async () => {
    startServe(TEST_PORT);
    await waitForPort(TEST_PORT, 20_000);

    const client = McpJsonRpcClient.forPort(TEST_PORT, '/');
    await client.initialize();

    const result = await client.listTools();
    expect(result.error).toBeUndefined();

    const toolsResult = result.result as { tools: Array<{ name: string }> };
    const toolNames = toolsResult.tools.map((t) => t.name);
    expect(toolNames).toContain('add');
    expect(toolNames).toContain('greet');
    expect(toolNames).toContain('transform_data');
  });

  it('should execute add tool and return correct result', async () => {
    startServe(TEST_PORT);
    await waitForPort(TEST_PORT, 20_000);

    const client = McpJsonRpcClient.forPort(TEST_PORT, '/');
    await client.initialize();

    const result = await client.callTool('add', { a: 3, b: 5 });
    expect(result.error).toBeUndefined();

    const callResult = result.result as { content: Array<{ text: string }> };
    const text = callResult.content.map((c) => c.text).join('');
    expect(text).toContain('8');
  });

  it('should list resources', async () => {
    startServe(TEST_PORT);
    await waitForPort(TEST_PORT, 20_000);

    const client = McpJsonRpcClient.forPort(TEST_PORT, '/');
    await client.initialize();

    const result = await client.listResources();
    expect(result.error).toBeUndefined();

    const resourcesResult = result.result as { resources: Array<{ name: string; uri: string }> };
    expect(resourcesResult.resources.length).toBeGreaterThan(0);
  });

  it('should list prompts', async () => {
    startServe(TEST_PORT);
    await waitForPort(TEST_PORT, 20_000);

    const client = McpJsonRpcClient.forPort(TEST_PORT, '/');
    await client.initialize();

    const result = await client.listPrompts();
    expect(result.error).toBeUndefined();

    const promptsResult = result.result as { prompts: Array<{ name: string }> };
    const promptNames = promptsResult.prompts.map((p) => p.name);
    expect(promptNames).toContain('code-review');
  });

  it('should respect custom port', async () => {
    const customPort = TEST_PORT + 1;
    const proc = spawnServer(['node', getCliBundlePath(), 'serve', '--port', String(customPort)]);
    serverProc = proc;

    await waitForPort(customPort, 20_000);

    const client = McpJsonRpcClient.forPort(customPort, '/');
    const result = await client.initialize();
    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();
  });
});
