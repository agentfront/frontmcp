/**
 * E2E tests for the SEA (Single Executable Application) CLI daemon.
 *
 * Tests the full production flow: build SEA binary -> install -> daemon
 * start/status/stop/logs -> MCP connectivity over Unix socket.
 *
 * This covers the critical path that was broken when the daemon spawned
 * `node -e` with external requires that couldn't resolve from the installed
 * location. The fix spawns `process.execPath` (the SEA binary itself) with
 * `__FRONTMCP_DAEMON_MODE=1` so all inlined code is available.
 *
 * If the SEA build toolchain is unavailable (e.g., missing postject),
 * all tests pass trivially with a warning.
 */

import { realpathSync } from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { fileExists, mkdtemp, readFile, stat, rm } from '@frontmcp/utils';
import { ensureSeaBuild, runSeaCli } from './helpers/exec-cli';
import { McpJsonRpcClient, httpOverSocket, waitForSocket } from './helpers/mcp-client';

const APP_NAME = 'cli-exec-demo';

// State shared across the ordered test suite
let seaAvailable = false;
let homeDir: string;
let prefixDir: string;
let binDir: string;
let installedBinaryPath: string;
let socketPath: string;
let pidPath: string;
let daemonPid: number | null = null;

/** Run the installed SEA binary with FRONTMCP_HOME isolation. */
function runInstalledCli(
  args: string[],
  extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(installedBinaryPath, args, {
      timeout: 30000,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test', FRONTMCP_HOME: homeDir, ...extraEnv },
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number };
    return {
      stdout: (error.stdout || '').toString(),
      stderr: (error.stderr || '').toString(),
      exitCode: error.status ?? 1,
    };
  }
}

function killByPid(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already dead */
  }
}

async function waitForFile(filePath: string, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fileExists(filePath)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe('SEA CLI Daemon E2E', () => {
  beforeAll(async () => {
    seaAvailable = await ensureSeaBuild();
    if (!seaAvailable) {
      console.warn('[e2e:sea] SEA binary not available — all daemon-sea tests will pass trivially.');
      return;
    }

    // Set up isolated directories
    homeDir = await mkdtemp(path.join(require('os').tmpdir(), 'frontmcp-sea-daemon-'));
    prefixDir = await mkdtemp(path.join(require('os').tmpdir(), 'frontmcp-sea-install-'));
    binDir = await mkdtemp(path.join(require('os').tmpdir(), 'frontmcp-sea-bin-'));

    // Install the SEA binary to a temp prefix
    const { stdout, exitCode } = runSeaCli(['install', '--prefix', prefixDir, '--bin-dir', binDir]);
    if (exitCode !== 0) {
      console.warn('[e2e:sea] Install failed:', stdout);
      seaAvailable = false;
      return;
    }

    // Resolve the installed binary path
    const appDir = path.join(prefixDir, 'apps', APP_NAME);
    const seaBinaryInInstall = path.join(appDir, `${APP_NAME}-cli-bin`);
    const symlinkPath = path.join(binDir, APP_NAME);

    if (await fileExists(symlinkPath)) {
      installedBinaryPath = realpathSync(symlinkPath);
    } else if (await fileExists(seaBinaryInInstall)) {
      installedBinaryPath = seaBinaryInInstall;
    } else {
      console.warn('[e2e:sea] Could not find installed SEA binary');
      seaAvailable = false;
      return;
    }

    // Pre-calculate daemon paths
    socketPath = path.join(homeDir, 'sockets', `${APP_NAME}.sock`);
    pidPath = path.join(homeDir, 'pids', `${APP_NAME}.pid`);
  }, 180000);

  afterAll(async () => {
    if (!seaAvailable) return;

    // Safety: kill daemon if still running
    if (daemonPid) {
      killByPid(daemonPid);
      daemonPid = null;
    }
    try {
      runInstalledCli(['daemon', 'stop']);
    } catch {
      /* ok */
    }

    await new Promise((r) => setTimeout(r, 500));

    // Clean up temp dirs
    for (const dir of [homeDir, prefixDir, binDir]) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        /* ok */
      }
    }
  });

  // ─── Build & Install Verification ──────────────────────────────────────

  it('should have SEA CLI binary available', async () => {
    if (!seaAvailable) return;
    expect(await fileExists(installedBinaryPath)).toBe(true);
    const stats = await stat(installedBinaryPath);
    expect(stats.mode & 0o111).not.toBe(0); // executable
  });

  // ─── Daemon Lifecycle ──────────────────────────────────────────────────

  it('daemon status before start should show not running', () => {
    if (!seaAvailable) return;
    const { stdout, exitCode } = runInstalledCli(['daemon', 'status']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Not running');
  });

  it('daemon start should succeed with PID', async () => {
    if (!seaAvailable) return;
    const { stdout, exitCode } = runInstalledCli(['daemon', 'start']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Daemon (started|already running)/);
    expect(stdout).toMatch(/PID: \d+/);

    const pidMatch = stdout.match(/PID: (\d+)/);
    if (pidMatch) {
      daemonPid = parseInt(pidMatch[1], 10);
    }

    // Wait for socket file to appear
    if (!(await fileExists(socketPath))) {
      const appeared = await waitForFile(socketPath, 15000);
      expect(appeared).toBe(true);
    }
  });

  it('daemon socket should respond to health check', async () => {
    if (!seaAvailable) return;
    await waitForSocket(socketPath, 20000);
    const response = await httpOverSocket(socketPath, { path: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('daemon status should show running after start', () => {
    if (!seaAvailable) return;
    const { stdout, exitCode } = runInstalledCli(['daemon', 'status']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Running');
    expect(stdout).toMatch(/PID: \d+/);
  });

  it('daemon double start should detect already running', () => {
    if (!seaAvailable) return;
    const { stdout, exitCode } = runInstalledCli(['daemon', 'start']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('already running');
  });

  it('PID file should have correct structure', async () => {
    if (!seaAvailable) return;
    expect(await fileExists(pidPath)).toBe(true);
    const pidData = JSON.parse(await readFile(pidPath));
    expect(pidData.pid).toEqual(expect.any(Number));
    expect(pidData.socketPath).toContain('.sock');
    expect(pidData.startedAt).toEqual(expect.any(String));
    expect(() => process.kill(pidData.pid, 0)).not.toThrow();
  });

  it('daemon logs should not contain ZodError or MODULE_NOT_FOUND', async () => {
    if (!seaAvailable) return;
    const logPath = path.join(homeDir, 'logs', `${APP_NAME}.log`);
    if (await fileExists(logPath)) {
      const content = await readFile(logPath);
      expect(content).not.toContain('ZodError');
      expect(content).not.toContain('MODULE_NOT_FOUND');
      expect(content).not.toContain('Cannot find module');
    }
  });

  it('daemon logs command should return output', () => {
    if (!seaAvailable) return;
    const { exitCode } = runInstalledCli(['daemon', 'logs', '-n', '20']);
    expect(exitCode).toBe(0);
  });

  // ─── MCP Connectivity ──────────────────────────────────────────────────

  it('should handle MCP initialize handshake via daemon socket', async () => {
    if (!seaAvailable) return;
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    const result = await client.initialize();

    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(client.getSessionId()).toBeDefined();

    const initResult = result.result as Record<string, unknown>;
    expect(initResult['protocolVersion']).toBeDefined();
    expect(initResult['capabilities']).toBeDefined();
  });

  it('should list tools via daemon socket', async () => {
    if (!seaAvailable) return;
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

  it('should execute tool via daemon socket', async () => {
    if (!seaAvailable) return;
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    await client.initialize();

    const result = await client.callTool('add', { a: 10, b: 20 });
    expect(result.error).toBeUndefined();

    const callResult = result.result as { content: Array<{ text: string }> };
    const text = callResult.content.map((c) => c.text).join('');
    expect(text).toContain('30');
  });

  it('should list resources via daemon socket', async () => {
    if (!seaAvailable) return;
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    await client.initialize();

    const result = await client.listResources();
    expect(result.error).toBeUndefined();

    const resourcesResult = result.result as { resources: Array<{ name: string; uri: string }> };
    expect(resourcesResult.resources.length).toBeGreaterThan(0);
  });

  it('should list prompts via daemon socket', async () => {
    if (!seaAvailable) return;
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    await client.initialize();

    const result = await client.listPrompts();
    expect(result.error).toBeUndefined();

    const promptsResult = result.result as { prompts: Array<{ name: string }> };
    const promptNames = promptsResult.prompts.map((p) => p.name);
    expect(promptNames).toContain('code-review');
  });

  // ─── Daemon Stop & Cleanup ─────────────────────────────────────────────

  it('daemon stop should succeed', () => {
    if (!seaAvailable) return;
    const { stdout, exitCode } = runInstalledCli(['daemon', 'stop']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Daemon stopped');
    daemonPid = null;
  });

  it('daemon status after stop should show not running', () => {
    if (!seaAvailable) return;
    const { stdout, exitCode } = runInstalledCli(['daemon', 'status']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Not running/);
  });

  it('socket file should be removed after stop', async () => {
    if (!seaAvailable) return;
    expect(await fileExists(socketPath)).toBe(false);
  });

  it('PID file should be removed after stop', async () => {
    if (!seaAvailable) return;
    expect(await fileExists(pidPath)).toBe(false);
  });

  // ─── Daemon Restart ────────────────────────────────────────────────────

  it('should start again after stop', async () => {
    if (!seaAvailable) return;
    const { stdout, exitCode } = runInstalledCli(['daemon', 'start']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Daemon started/);

    const pidMatch = stdout.match(/PID: (\d+)/);
    if (pidMatch) {
      daemonPid = parseInt(pidMatch[1], 10);
    }

    if (!(await fileExists(socketPath))) {
      await waitForFile(socketPath, 15000);
    }
    await waitForSocket(socketPath, 20000);
  });

  it('should serve MCP after restart', async () => {
    if (!seaAvailable) return;
    const client = McpJsonRpcClient.forSocket(socketPath, '/');
    const initResult = await client.initialize();
    expect(initResult.result).toBeDefined();

    const toolResult = await client.callTool('add', { a: 5, b: 7 });
    expect(toolResult.error).toBeUndefined();
    const text = (toolResult.result as { content: Array<{ text: string }> }).content.map((c) => c.text).join('');
    expect(text).toContain('12');
  });

  it('should stop cleanly after restart', () => {
    if (!seaAvailable) return;
    const { stdout, exitCode } = runInstalledCli(['daemon', 'stop']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Daemon stopped');
    daemonPid = null;
  });
});
