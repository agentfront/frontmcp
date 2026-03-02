/**
 * Supervisor class: spawns a child MCP server process with auto-restart
 * and exponential backoff.
 */

import { spawn, ChildProcess } from 'child_process';
import { StartOptions } from './types';
import { socketFilePath } from './paths';
import { createLogStreams } from './log-utils';
import { writePidFile, removePidFile } from './pidfile';
import { checkHealth } from './health';
import { getSelfVersion } from '../../core/version';

const DEFAULT_MAX_RESTARTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;
const HEALTH_CHECK_INTERVAL_MS = 30000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10000;

export class Supervisor {
  private child: ChildProcess | null = null;
  private running = false;
  private restartCount = 0;
  private readonly maxRestarts: number;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: StartOptions;
  private resolvedSocketPath: string | undefined;

  constructor(opts: StartOptions) {
    this.opts = opts;
    this.maxRestarts = opts.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    if (opts.socket || opts.socketPath) {
      this.resolvedSocketPath = opts.socketPath || socketFilePath(opts.name);
    }
  }

  async start(): Promise<void> {
    this.running = true;
    this.restartCount = 0;
    await this.spawnChild();
  }

  async stop(force = false): Promise<void> {
    this.running = false;
    this.stopHealthChecks();

    if (!this.child) return;

    if (force) {
      this.child.kill('SIGKILL');
    } else {
      this.child.kill('SIGTERM');

      // Wait for graceful shutdown, then force kill
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.child) {
            this.child.kill('SIGKILL');
          }
          resolve();
        }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

        if (this.child) {
          this.child.on('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        } else {
          clearTimeout(timer);
          resolve();
        }
      });
    }

    removePidFile(this.opts.name);
    this.child = null;
  }

  getChild(): ChildProcess | null {
    return this.child;
  }

  getRestartCount(): number {
    return this.restartCount;
  }

  private async spawnChild(): Promise<void> {
    const { name, entry, port, dbPath, env: extraEnv } = this.opts;

    const logs = createLogStreams(name);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...extraEnv,
    };

    if (this.resolvedSocketPath) {
      env['FRONTMCP_SOCKET_PATH'] = this.resolvedSocketPath;
    }
    if (port) {
      env['PORT'] = String(port);
    }
    if (dbPath) {
      env['FRONTMCP_SQLITE_PATH'] = dbPath;
    }

    const child = spawn('npx', ['-y', 'tsx', '--conditions', 'node', entry], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      detached: false,
    });

    this.child = child;

    if (child.stdout) {
      child.stdout.pipe(logs.stdout);
    }
    if (child.stderr) {
      child.stderr.pipe(logs.stderr);
    }

    if (child.pid === undefined) {
      throw new Error(`Failed to spawn process for "${name}": child PID is undefined`);
    }

    // Write PID file
    writePidFile(name, {
      pid: child.pid,
      name,
      entry,
      port,
      socketPath: this.resolvedSocketPath,
      dbPath,
      startedAt: new Date().toISOString(),
      restartCount: this.restartCount,
      supervisorPid: process.pid,
      cliVersion: getSelfVersion(),
    });

    // Start health checks
    this.startHealthChecks();

    child.on('exit', (code, signal) => {
      const timestamp = new Date().toISOString();
      const msg = `[${timestamp}] Process exited: code=${code} signal=${signal}\n`;

      try {
        logs.stderr.write(msg);
      } catch {
        // ignore
      }

      this.child = null;
      this.stopHealthChecks();

      if (this.running) {
        this.scheduleRestart();
      } else {
        removePidFile(name);
      }
    });

    child.on('error', (err) => {
      const timestamp = new Date().toISOString();
      const msg = `[${timestamp}] Process error: ${err.message}\n`;

      try {
        logs.stderr.write(msg);
      } catch {
        // ignore
      }

      this.child = null;
      this.stopHealthChecks();

      if (this.running) {
        this.scheduleRestart();
      } else {
        removePidFile(name);
      }
    });
  }

  private scheduleRestart(): void {
    if (this.restartCount >= this.maxRestarts) {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] ${this.opts.name}: max restarts (${this.maxRestarts}) reached, giving up`);
      this.running = false;
      removePidFile(this.opts.name);
      return;
    }

    const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, this.restartCount), MAX_BACKOFF_MS);
    this.restartCount++;

    const timestamp = new Date().toISOString();
    console.error(
      `[${timestamp}] ${this.opts.name}: restarting in ${backoff}ms (attempt ${this.restartCount}/${this.maxRestarts})`,
    );

    setTimeout(() => {
      if (this.running) {
        this.spawnChild().catch((err) => {
          console.error(`Failed to restart ${this.opts.name}: ${err.message}`);
          this.running = false;
          removePidFile(this.opts.name);
        });
      }
    }, backoff);
  }

  private startHealthChecks(): void {
    this.stopHealthChecks();

    this.healthTimer = setInterval(async () => {
      if (!this.running || !this.child) return;

      const result = await checkHealth({
        port: this.opts.port,
        socketPath: this.resolvedSocketPath,
      });

      if (!result.healthy && this.running && this.child) {
        const timestamp = new Date().toISOString();
        console.error(
          `[${timestamp}] ${this.opts.name}: health check failed (${result.error || `status ${result.statusCode}`})`,
        );
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }
}
