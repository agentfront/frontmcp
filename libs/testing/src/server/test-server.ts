/**
 * @file test-server.ts
 * @description Test server management for E2E testing
 */

import { spawn, ChildProcess } from 'child_process';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface TestServerOptions {
  /** Port to run the server on (default: random available port) */
  port?: number;
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
  private readonly options: Required<TestServerOptions>;
  private _info: TestServerInfo;
  private logs: string[] = [];

  private constructor(options: TestServerOptions, port: number) {
    this.options = {
      port,
      command: options.command ?? '',
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? {},
      startupTimeout: options.startupTimeout ?? 30000,
      healthCheckPath: options.healthCheckPath ?? '/health',
      debug: options.debug ?? false,
    };

    this._info = {
      baseUrl: `http://localhost:${port}`,
      port,
    };
  }

  /**
   * Start a test server with custom command
   */
  static async start(options: TestServerOptions): Promise<TestServer> {
    const port = options.port ?? (await findAvailablePort());
    const server = new TestServer(options, port);
    await server.startProcess();
    return server;
  }

  /**
   * Start an Nx project as test server
   */
  static async startNx(project: string, options: Partial<TestServerOptions> = {}): Promise<TestServer> {
    const port = options.port ?? (await findAvailablePort());

    const serverOptions: TestServerOptions = {
      ...options,
      port,
      command: `npx nx serve ${project} --port ${port}`,
      cwd: options.cwd ?? process.cwd(),
    };

    const server = new TestServer(serverOptions, port);
    await server.startProcess();
    return server;
  }

  /**
   * Create a test server connected to an already running server
   */
  static connect(baseUrl: string): TestServer {
    const url = new URL(baseUrl);
    const port = parseInt(url.port, 10) || 80;

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
    if (this.process) {
      this.log('Stopping server...');

      // Try graceful shutdown first
      this.process.kill('SIGTERM');

      // Wait for process to exit
      const exitPromise = new Promise<void>((resolve) => {
        if (this.process) {
          this.process.on('exit', () => resolve());
        } else {
          resolve();
        }
      });

      // Force kill after timeout
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });

      await Promise.race([exitPromise, timeoutPromise]);
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

    // Handle process exit - use once() to avoid memory leak from listener not being cleaned up
    this.process.once('exit', (code) => {
      this.log(`Server process exited with code ${code}`);
    });

    // Wait for server to be ready
    await this.waitForReady();
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
 * Find an available port
 */
async function findAvailablePort(): Promise<number> {
  // Use a simple approach: try to create a server on port 0 to get an available port
  const { createServer } = await import('net');

  return new Promise((resolve, reject) => {
    const server = createServer();

    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Could not get port'));
      }
    });

    server.on('error', reject);
  });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
