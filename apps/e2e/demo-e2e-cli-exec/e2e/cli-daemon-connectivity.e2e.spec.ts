/**
 * E2E tests for daemon MCP connectivity.
 *
 * Verifies that the daemon socket actually serves MCP traffic — not just
 * that the process starts/stops, but that tools, resources, and prompts
 * are reachable over the Unix socket via FrontMcpInstance.runUnixSocket().
 */

import * as os from 'os';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { mkdtemp, rm } from '@frontmcp/utils';
import { ensureBuild, getServerBundlePath, runCli } from './helpers/exec-cli';
import { McpJsonRpcClient, httpOverSocket, waitForSocket } from './helpers/mcp-client';

function killQuiet(proc: ChildProcess | null): void {
  try {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

describe('CLI Daemon Connectivity E2E', () => {
  let homeDir: string;
  let socketPath: string;
  let daemonProc: ChildProcess | null = null;

  beforeAll(async () => {
    await ensureBuild();
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-daemon-conn-'));
  });

  afterAll(async () => {
    killQuiet(daemonProc);
    daemonProc = null;
    await new Promise((r) => setTimeout(r, 500));
    try {
      await rm(homeDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  /**
   * Start a daemon using runUnixSocket (same approach as the generated daemon command).
   * This uses the node -e inline script approach for standard Node.js execution.
   */
  function startDaemon(socket: string): ChildProcess {
    const bundlePath = getServerBundlePath();
    const script = [
      'require("reflect-metadata");',
      `var mod = require(${JSON.stringify(bundlePath)});`,
      'var sdk = require("@frontmcp/sdk");',
      'var FrontMcpInstance = sdk.FrontMcpInstance || sdk.default.FrontMcpInstance;',
      'var raw = mod.default || mod;',
      'var config = (typeof raw === "function" && typeof Reflect !== "undefined" && Reflect.getMetadata)',
      '  ? (Reflect.getMetadata("__frontmcp:config", raw) || raw) : raw;',
      `FrontMcpInstance.runUnixSocket(Object.assign({}, config, { socketPath: ${JSON.stringify(socket)} }))`,
      `  .then(function() { console.log("Daemon listening on ${socket}"); })`,
      '  .catch(function(e) { console.error("Daemon failed:", e); process.exit(1); });',
    ].join('\n');

    const proc = spawn('node', ['-e', script], {
      env: { ...process.env, NODE_ENV: 'test' },
    });
    daemonProc = proc;
    return proc;
  }

  it('should start daemon and have socket ready for MCP', async () => {
    socketPath = path.join(homeDir, 'test-daemon.sock');
    startDaemon(socketPath);
    await waitForSocket(socketPath, 20_000);
  });

  it('should respond to health check over socket', async () => {
    const response = await httpOverSocket(socketPath, { path: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('should handle MCP initialize over socket', async () => {
    // entryPath defaults to '' (root) for this fixture
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    const result = await client.initialize();

    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(client.getSessionId()).toBeDefined();

    const initResult = result.result as Record<string, unknown>;
    expect(initResult['protocolVersion']).toBeDefined();
    expect(initResult['capabilities']).toBeDefined();
  });

  it('should list tools over socket', async () => {
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    await client.initialize();

    const result = await client.listTools();
    expect(result.error).toBeUndefined();

    const toolsResult = result.result as { tools: Array<{ name: string }> };
    const toolNames = toolsResult.tools.map((t) => t.name);
    expect(toolNames).toContain('add');
    expect(toolNames).toContain('greet');
    expect(toolNames).toContain('transform_data');
  });

  it('should execute tool over socket', async () => {
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    await client.initialize();

    const result = await client.callTool('add', { a: 10, b: 20 });
    expect(result.error).toBeUndefined();

    const callResult = result.result as { content: Array<{ text: string }> };
    const text = callResult.content.map((c) => c.text).join('');
    expect(text).toContain('30');
  });

  it('should list resources over socket', async () => {
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    await client.initialize();

    const result = await client.listResources();
    expect(result.error).toBeUndefined();

    const resourcesResult = result.result as { resources: Array<{ name: string; uri: string }> };
    expect(resourcesResult.resources.length).toBeGreaterThan(0);
  });

  it('should list prompts over socket', async () => {
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    await client.initialize();

    const result = await client.listPrompts();
    expect(result.error).toBeUndefined();

    const promptsResult = result.result as { prompts: Array<{ name: string }> };
    const promptNames = promptsResult.prompts.map((p) => p.name);
    expect(promptNames).toContain('code-review');
  });

  it('should route CLI tool commands through running daemon', () => {
    // Use the CLI's built-in tool routing which checks for daemon socket
    // We need a daemon on the expected socket path for CLI auto-routing
    const { stdout, exitCode } = runCli(['add', '--a', '1', '--b', '2'], {
      FRONTMCP_DAEMON_SOCKET: socketPath,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('3');
  });

  it('should stop daemon cleanly', async () => {
    killQuiet(daemonProc);

    const exitPromise = new Promise<void>((resolve) => {
      if (!daemonProc || daemonProc.killed) {
        resolve();
        return;
      }
      daemonProc.on('close', () => resolve());
    });

    await exitPromise;
    daemonProc = null;

    // Socket file should be cleaned up by signal handler
    await new Promise((r) => setTimeout(r, 500));
  });

  it('should restart daemon and serve MCP again', async () => {
    socketPath = path.join(homeDir, 'test-daemon-restart.sock');
    startDaemon(socketPath);
    await waitForSocket(socketPath, 20_000);

    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    const initResult = await client.initialize();
    expect(initResult.result).toBeDefined();

    const toolsResult = await client.listTools();
    const toolNames = (toolsResult.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(toolNames).toContain('add');
  });
});
