/**
 * @file test-server.ts
 * @description Test server management for E2E testing
 */

import { spawn, ChildProcess } from 'child_process';
import { ServerStartError } from '../errors';
import { reservePort } from './port-registry';

// Environment variable to enable debug output for all test servers
const DEBUG_SERVER = process.env['DEBUG_SERVER'] === '1' || process.env['DEBUG'] === '1';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface TestServerOptions {
  /** Port to run the server on (default: from project range or random) */
  port?: number;
  /** E2E project name for port range allocation */
  project?: string;
  /** Command to start the server */
  command?: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout for server startup in milliseconds (default: 30000) */
  startupTimeout?: number;
  /** Path to check for server readiness (default: /health) */
  healthCheckPath?: string;
  /** Enable debug logging */
  debug?: boolean;
}

export interface TestServerInfo {
  /** Base URL of the server */
  baseUrl: string;
  /** Port the server is running on */
  port: number;
  /** Process ID (if available) */
  pid?: number;
}

// ═══════════════════════════════════════════════════════════════════
// TEST SERVER CLASS
// ═══════════════════════════════════════════════════════════════════

/**
 * Manages test server lifecycle for E2E testing
 *
 * @example
 * ```typescript
 * // Start a server with custom command
 * const server = await TestServer.start({
 *   command: 'node dist/main.js',
 *   port: 3003,
 *   cwd: './apps/my-server',
 * });
 *
 * // Or start an Nx project
 * const server = await TestServer.startNx('demo-public', { port: 3003 });
 *
 * // Use the server
 * console.log(server.info.baseUrl); // http://localhost:3003
 *
 * // Stop when done
 * await server.stop();
 * ```
 */
export class TestServer {
  private process: ChildProcess | null = null;
  private readonly options: Required<Omit<TestServerOptions, 'project'>> & { project?: string };
  private _info: TestServerInfo;
  private logs: string[] = [];
  private portRelease: (() => Promise<void>) | null = null;

  private constructor(options: TestServerOptions, port: number, portRelease?: () => Promise<void>) {
    this.options = {
      port,
      project: options.project,
      command: options.command ?? '',
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? {},
      startupTimeout: options.startupTimeout ?? 30000,
      healthCheckPath: options.healthCheckPath ?? '/health',
      debug: options.debug ?? DEBUG_SERVER,
    };
    this.portRelease = portRelease ?? null;

    this._info = {
      baseUrl: `http://localhost:${port}`,
      port,
    };
  }

  /**
   * Start a test server with custom command
   */
  static async start(options: TestServerOptions): Promise<TestServer> {
    // Use port registry for allocation
    const project = options.project ?? 'default';
    const { port, release } = await reservePort(project, options.port);

    const server = new TestServer(options, port, release);
    try {
      await server.startProcess();
    } catch (error) {
      await server.stop(); // Clean up spawned process to prevent leaks
      throw error;
    }
    return server;
  }

  /**
   * Start an Nx project as test server
   */
  static async startNx(project: string, options: Partial<TestServerOptions> = {}): Promise<TestServer> {
    // Validate project name contains only safe characters to prevent shell injection
    if (!/^[\w-]+$/.test(project)) {
      throw new Error(
        `Invalid project name: ${project}. Must contain only alphanumeric, underscore, and hyphen characters.`,
      );
    }

    // Use the Nx project name for port range allocation
    const { port, release } = await reservePort(project, options.port);

    const serverOptions: TestServerOptions = {
      ...options,
      port,
      project,
      command: `npx nx serve ${project} --port ${port}`,
      cwd: options.cwd ?? process.cwd(),
    };

    const server = new TestServer(serverOptions, port, release);
    try {
      await server.startProcess();
    } catch (error) {
      await server.stop(); // Clean up spawned process to prevent leaks
      throw error;
    }
    return server;
  }

  /**
   * Create a test server connected to an already running server
   */
  static connect(baseUrl: string): TestServer {
    const url = new URL(baseUrl);
    const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);

    const server = new TestServer(
      {
        command: '',
        port,
      },
      port,
    );

    server._info = {
      baseUrl: baseUrl.replace(/\/$/, ''),
      port,
    };

    return server;
  }

  /**
   * Get server information
   */
  get info(): TestServerInfo {
    return { ...this._info };
  }

  /**
   * Stop the test server
   */
  async stop(): Promise<void> {
    if (this.portRelease) {
      await this.portRelease();
      this.portRelease = null;
    }

    if (this.process) {
      this.log('Stopping server...');

      // Try graceful shutdown first
      this.process.kill('SIGTERM');

      // Wait for process to exit
      const exitPromise = new Promise<void>((resolve) => {
        if (this.process) {
          this.process.once('exit', () => resolve());
        } else {
          resolve();
        }
      });

      // Force kill after timeout (but still wait for actual exit)
      const killTimeout = setTimeout(() => {
        if (this.process) {
          this.log('Force killing server after timeout...');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      await exitPromise;
      clearTimeout(killTimeout);
      this.process = null;
      this.log('Server stopped');
    }
  }

  /**
   * Wait for server to be ready
   */
  async waitForReady(timeout?: number): Promise<void> {
    const timeoutMs = timeout ?? this.options.startupTimeout;
    const deadline = Date.now() + timeoutMs;
    const checkInterval = 100;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${this._info.baseUrl}${this.options.healthCheckPath}`, {
          method: 'GET',
          signal: AbortSignal.timeout(1000),
        });

        if (response.ok || response.status === 404) {
          // 404 is okay - it means the server is running but might not have a health endpoint
          this.log('Server is ready');
          return;
        }
      } catch {
        // Server not ready yet
      }

      await sleep(checkInterval);
    }

    throw new Error(`Server did not become ready within ${timeoutMs}ms`);
  }

  /**
   * Restart the server
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.startProcess();
  }

  /**
   * Get captured server logs
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Clear captured logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════

  private async startProcess(): Promise<void> {
    if (!this.options.command) {
      // No command means we're connecting to an existing server
      await this.waitForReady();
      return;
    }

    this.log(`Starting server: ${this.options.command}`);

    const env = {
      ...process.env,
      ...this.options.env,
      PORT: String(this.options.port),
    };

    // Release port reservation just before spawning so the server can bind it
    if (this.portRelease) {
      await this.portRelease();
      this.portRelease = null;
    }

    // Use shell: true to handle complex commands with quoted arguments
    // This avoids fragile command parsing with split(' ')
    this.process = spawn(this.options.command, [], {
      cwd: this.options.cwd,
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // pid can be undefined if spawn fails
    if (this.process.pid !== undefined) {
      this._info.pid = this.process.pid;
    }

    // Track process exit for early failure detection
    let processExited = false;
    let exitCode: number | null = null;
    let exitError: Error | null = null;

    // Capture stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.logs.push(text);
      if (this.options.debug) {
        console.log('[SERVER]', text);
      }
    });

    // Capture stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.logs.push(`[ERROR] ${text}`);
      if (this.options.debug) {
        console.error('[SERVER ERROR]', text);
      }
    });

    // Handle spawn errors to prevent unhandled error events
    this.process.on('error', (err) => {
      this.logs.push(`[SPAWN ERROR] ${err.message}`);
      exitError = err;
      if (this.options.debug) {
        console.error('[SERVER SPAWN ERROR]', err);
      }
    });

    // Handle process exit - track early failures
    this.process.once('exit', (code) => {
      processExited = true;
      exitCode = code;
      this.log(`Server process exited with code ${code}`);
    });

    // Wait for server to be ready, but detect early process exit
    try {
      await this.waitForReadyWithExitDetection(() => {
        if (exitError) {
          return { exited: true, error: exitError };
        }
        if (processExited) {
          const allLogs = this.logs.join('\n');
          const errorLogs = this.logs
            .filter((l) => l.includes('[ERROR]') || l.toLowerCase().includes('error'))
            .join('\n');
          return {
            exited: true,
            error: new ServerStartError(
              `Server process exited unexpectedly with code ${exitCode}.\n\n` +
                `Command: ${this.options.command}\n` +
                `CWD: ${this.options.cwd}\n` +
                `Port: ${this.options.port}\n\n` +
                `=== Error Logs ===\n${errorLogs || 'No error logs captured'}\n\n` +
                `=== Full Logs ===\n${allLogs || 'No logs captured'}`,
            ),
          };
        }
        return { exited: false };
      });
    } catch (error) {
      // Always print logs on startup failure for debugging
      this.printLogsOnFailure('Server startup failed');
      throw error;
    }
  }

  /**
   * Print server logs on failure for debugging
   */
  private printLogsOnFailure(context: string): void {
    const allLogs = this.logs.join('\n');
    if (allLogs) {
      console.error(`\n[TestServer] ${context}`);
      console.error(`[TestServer] Command: ${this.options.command}`);
      console.error(`[TestServer] Port: ${this.options.port}`);
      console.error(`[TestServer] CWD: ${this.options.cwd}`);
      console.error(`[TestServer] === Server Logs ===\n${allLogs}`);
      console.error(`[TestServer] === End Logs ===\n`);
    }
  }

  /**
   * Wait for server to be ready, but also detect early process exit
   */
  private async waitForReadyWithExitDetection(checkExit: () => { exited: boolean; error?: Error }): Promise<void> {
    const timeoutMs = this.options.startupTimeout;
    const deadline = Date.now() + timeoutMs;
    const checkInterval = 100;
    let lastHealthCheckError: string | null = null;
    let healthCheckAttempts = 0;

    this.log(`Waiting for server to be ready (timeout: ${timeoutMs}ms)...`);

    while (Date.now() < deadline) {
      // Check if process has exited before continuing to poll
      const exitStatus = checkExit();
      if (exitStatus.exited) {
        throw exitStatus.error ?? new ServerStartError('Server process exited unexpectedly');
      }

      healthCheckAttempts++;
      try {
        const healthUrl = `${this._info.baseUrl}${this.options.healthCheckPath}`;
        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(1000),
        });

        if (response.ok || response.status === 404) {
          // 404 is okay - it means the server is running but might not have a health endpoint
          this.log(`Server is ready after ${healthCheckAttempts} health check attempts`);
          return;
        }
        lastHealthCheckError = `HTTP ${response.status}: ${response.statusText}`;
      } catch (err) {
        // Server not ready yet - capture error for debugging
        lastHealthCheckError = err instanceof Error ? err.message : String(err);
      }

      // Log progress every 5 seconds
      const elapsed = Date.now() - (deadline - timeoutMs);
      if (elapsed > 0 && elapsed % 5000 < checkInterval) {
        this.log(
          `Still waiting for server... (${Math.round(elapsed / 1000)}s elapsed, last error: ${lastHealthCheckError})`,
        );
      }

      await sleep(checkInterval);
    }

    // Final check before throwing timeout error
    const finalExitStatus = checkExit();
    if (finalExitStatus.exited) {
      throw finalExitStatus.error ?? new ServerStartError('Server process exited unexpectedly');
    }

    // Build detailed timeout error
    const allLogs = this.logs.join('\n');
    throw new ServerStartError(
      `Server did not become ready within ${timeoutMs}ms.\n\n` +
        `Command: ${this.options.command}\n` +
        `CWD: ${this.options.cwd}\n` +
        `Port: ${this.options.port}\n` +
        `Health check URL: ${this._info.baseUrl}${this.options.healthCheckPath}\n` +
        `Health check attempts: ${healthCheckAttempts}\n` +
        `Last health check error: ${lastHealthCheckError ?? 'none'}\n\n` +
        `=== Server Logs ===\n${allLogs || 'No logs captured'}\n\n` +
        `TIP: Set DEBUG_SERVER=1 or DEBUG=1 environment variable for verbose output`,
    );
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[TestServer] ${message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export port registry utilities
export {
  reservePort,
  getProjectPort,
  getProjectPorts,
  getPortRange,
  releaseAllPorts,
  getReservedPorts,
  E2E_PORT_RANGES,
  type E2EProject,
} from './port-registry';
