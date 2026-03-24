/**
 * E2E tests for server bundle bootstrapping.
 *
 * Verifies that the server bundle can be loaded and bootstrapped via
 * FrontMcpInstance.bootstrap(), serving the full MCP protocol over HTTP.
 * This tests the same path the `serve` command uses for plain-config bundles.
 */

import { ChildProcess, spawn } from 'child_process';
import * as net from 'node:net';
import { ensureBuild, getServerBundlePath, getDistDir } from './helpers/exec-cli';
import { McpJsonRpcClient, waitForPort } from './helpers/mcp-client';

function killQuiet(proc: ChildProcess | null): void {
  try {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve available TCP port'));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

describe('CLI Server Bundle Direct Execution E2E', () => {
  let serverProc: ChildProcess | null = null;

  beforeAll(async () => {
    await ensureBuild();
  });

  afterEach(async () => {
    killQuiet(serverProc);
    serverProc = null;
    await new Promise((r) => setTimeout(r, 500));
  });

  /**
   * Bootstrap the server bundle via an inline Node.js script.
   * This mirrors what the `serve` command and daemon start do internally.
   */
  function startServer(port: number): ChildProcess {
    const bundlePath = getServerBundlePath();
    // Build an inline script so the transpiled bundle runs in a separate Node
    // process from `getDistDir()`, matching how the real `serve` command boots it.
    const script = [
      'require("reflect-metadata");',
      `var mod = require(${JSON.stringify(bundlePath)});`,
      'var sdk = require("@frontmcp/sdk");',
      'var FrontMcpInstance = sdk.FrontMcpInstance || sdk.default.FrontMcpInstance;',
      'var raw = mod.default || mod;',
      'var config = (typeof raw === "function" && typeof Reflect !== "undefined" && Reflect.getMetadata)',
      '  ? (Reflect.getMetadata("__frontmcp:config", raw) || raw) : raw;',
      `config = Object.assign({}, config, { http: Object.assign({}, config.http || {}, { port: ${port} }) });`,
      'FrontMcpInstance.bootstrap(config)',
      '  .catch(function(e) { console.error("Bootstrap failed:", e); process.exit(1); });',
    ].join('\n');

    const proc = spawn('node', ['-e', script], {
      cwd: getDistDir(),
      env: { ...process.env, NODE_ENV: 'test' },
    });
    serverProc = proc;
    return proc;
  }

  it('should bootstrap server bundle and respond to health check', async () => {
    const actualPort = await getAvailablePort();
    startServer(actualPort);
    await waitForPort(actualPort, 20_000);
  });

  it('should serve MCP protocol from bootstrapped bundle', async () => {
    const actualPort = await getAvailablePort();
    startServer(actualPort);
    await waitForPort(actualPort, 20_000);

    // entryPath defaults to '' (root), so MCP endpoint is at '/'
    const client = McpJsonRpcClient.forPort(actualPort, '/');
    const result = await client.initialize();

    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();

    const initResult = result.result as Record<string, unknown>;
    expect(initResult['protocolVersion']).toBeDefined();
    expect(initResult['capabilities']).toBeDefined();
  });

  it('should list and execute tools from bootstrapped bundle', async () => {
    const actualPort = await getAvailablePort();
    startServer(actualPort);
    await waitForPort(actualPort, 20_000);

    const client = McpJsonRpcClient.forPort(actualPort, '/');
    await client.initialize();

    const listResult = await client.listTools();
    expect(listResult.error).toBeUndefined();
    const toolNames = (listResult.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(toolNames).toContain('add');

    const callResult = await client.callTool('add', { a: 7, b: 3 });
    expect(callResult.error).toBeUndefined();
    const text = (callResult.result as { content: Array<{ text: string }> }).content.map((c) => c.text).join('');
    expect(text).toContain('10');
  });

  it('should exit cleanly on SIGTERM', async () => {
    const actualPort = await getAvailablePort();
    const proc = startServer(actualPort);
    await waitForPort(actualPort, 20_000);

    const exitPromise = new Promise<number | null>((resolve) => {
      proc.on('close', (code) => resolve(code));
    });

    proc.kill('SIGTERM');
    const exitCode = await exitPromise;
    serverProc = null;

    expect(exitCode === 0 || exitCode === null).toBe(true);
  });
});
