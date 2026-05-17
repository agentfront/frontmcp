/**
 * Child supervisor for the dev bridge (issue #399).
 *
 * Owns the user-code subprocess. Spawns it, watches for the ready
 * sentinel (or a TCP probe in HTTP mode), restarts it on watcher events,
 * and surfaces lifecycle events to the state machine.
 *
 * Two modes:
 *
 *   - **HTTP mode (default)**: `npx -y tsx --conditions node <entry>` with
 *     `stdio: 'pipe'`. The child boots a normal FrontMCP HTTP listener on
 *     `FRONTMCP_DEV_PORT`. The supervisor TCP-probes the port to confirm
 *     readiness, OR greps the child's stderr for the `__FRONTMCP_BOOTSTRAP_COMPLETE__`
 *     sentinel when `FRONTMCP_DEV_BOOTSTRAP_SENTINEL=1` is set.
 *
 *   - **Pipe mode (`--serve`)**: `node --import tsx <entry>` with
 *     `stdio: ['pipe', 'pipe', 'pipe', 'ipc']`. `FRONTMCP_DEV_STDIO_FD=3`
 *     tells the SDK to point `runStdio` at the IPC pipe. Readiness =
 *     first `message` over the IPC channel.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';

import type { BridgeLogger } from './log';

export type SupervisorMode = 'http' | 'pipe';

export interface ChildSupervisorOptions {
  mode: SupervisorMode;
  entry: string;
  log: BridgeLogger;
  /** Pinned session id passed to the child for HTTP-mode session continuity. */
  sessionId?: string;
  /** Port for HTTP mode. Ignored in pipe mode. */
  port?: number;
  /** Called once the child is ready to accept traffic. */
  onReady: (child: ChildProcess) => void | Promise<void>;
  /** Called when the child exits (expected or otherwise). */
  onExit: (reason: string) => void | Promise<void>;
  /** Max time to wait for a child to become ready before giving up. */
  readyTimeoutMs?: number;
}

export interface ChildSupervisor {
  start(): Promise<void>;
  /** Kill the current child, spawn a replacement, wait for ready. */
  restart(): Promise<void>;
  /** Final shutdown. */
  stop(): Promise<void>;
  /** Current child handle (undefined when no child is running). */
  current(): ChildProcess | undefined;
}

const READY_SENTINEL = '__FRONTMCP_BOOTSTRAP_COMPLETE__';

export function createChildSupervisor(options: ChildSupervisorOptions): ChildSupervisor {
  const { mode, entry, log, sessionId, port, onReady, onExit, readyTimeoutMs = 30_000 } = options;

  let current: ChildProcess | undefined;
  let killSignaled = false;

  function buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FRONTMCP_DEV_BOOTSTRAP_SENTINEL: '1',
    };
    if (sessionId) env['FRONTMCP_DEV_FORCE_SESSION_ID'] = sessionId;
    if (mode === 'http' && port) env['FRONTMCP_DEV_PORT'] = String(port);
    if (mode === 'pipe') env['FRONTMCP_DEV_STDIO_FD'] = '3';
    return env;
  }

  function spawnChild(): ChildProcess {
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    if (mode === 'http') {
      // tsx as a loader; bridge owns the watcher (no --watch here).
      return spawn(npxCmd, ['-y', 'tsx', '--conditions', 'node', entry], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildEnv(),
      });
    }
    // Pipe mode: pair an IPC channel as FD 3 so the child can read/write
    // JSON frames there. Node sets up the IPC machinery automatically when
    // 'ipc' is the 4th stdio entry — the resulting FD lands at 3.
    return spawn(npxCmd, ['-y', 'tsx', '--conditions', 'node', entry], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: buildEnv(),
    });
  }

  async function probeReady(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let resolved = false;
      const cleanup = (): void => {
        clearTimeout(deadlineTimer);
        clearInterval(tcpProbeTimer);
        child.stderr?.off('data', onStderr);
        child.off('message', onMessage);
        child.off('exit', onExitDuringBoot);
      };

      const deadlineTimer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`child did not become ready within ${readyTimeoutMs}ms`));
      }, readyTimeoutMs).unref();

      const onStderr = (chunk: Buffer | string): void => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        if (text.includes(READY_SENTINEL)) {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve();
        }
      };
      child.stderr?.on('data', onStderr);

      const onMessage = (): void => {
        if (mode !== 'pipe' || resolved) return;
        // First IPC message from the child counts as ready in pipe mode.
        resolved = true;
        cleanup();
        resolve();
      };
      if (mode === 'pipe') child.on('message', onMessage);

      const onExitDuringBoot = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`child exited during boot: code=${code} signal=${signal ?? 'null'}`));
      };
      child.once('exit', onExitDuringBoot);

      // HTTP mode fallback: TCP probe in parallel with the sentinel scan.
      const tcpProbeTimer =
        mode === 'http' && port
          ? setInterval(() => {
              if (resolved) return;
              const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
                sock.end();
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve();
              });
              sock.once('error', () => sock.destroy());
              sock.setTimeout(500, () => sock.destroy());
            }, 250).unref()
          : setInterval(() => undefined, 60_000).unref();
    });
  }

  async function killCurrent(): Promise<void> {
    if (!current) return;
    killSignaled = true;
    const dyingChild = current;
    try {
      dyingChild.kill('SIGTERM');
    } catch {
      // ignore
    }
    const forceKill = setTimeout(() => {
      try {
        dyingChild.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 2000).unref();
    await new Promise<void>((resolve) => {
      if (dyingChild.exitCode !== null || dyingChild.signalCode !== null) return resolve();
      dyingChild.once('exit', () => resolve());
    });
    clearTimeout(forceKill);
    killSignaled = false;
  }

  function wireExitHandler(child: ChildProcess): void {
    child.once('exit', (code, signal) => {
      const reason = killSignaled ? 'killed-for-restart' : `code=${code ?? 'null'} signal=${signal ?? 'null'}`;
      log.warn('child-exited', { reason });
      void onExit(reason);
    });
    // Forward child stderr to the log file (never to our stdout).
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        if (line.includes(READY_SENTINEL)) continue;
        log.info('child-stderr', { line: line.slice(0, 500) });
      }
    });
  }

  return {
    current: () => current,
    async start() {
      log.info('child-spawn', { mode, entry, port: port ?? null });
      const child = spawnChild();
      current = child;
      wireExitHandler(child);
      await probeReady(child);
      log.info('child-ready', { mode, pid: child.pid ?? null });
      await onReady(child);
    },
    async restart() {
      log.info('child-restart-start');
      await killCurrent();
      current = undefined;
      const child = spawnChild();
      current = child;
      wireExitHandler(child);
      await probeReady(child);
      log.info('child-restart-ready', { pid: child.pid ?? null });
      await onReady(child);
    },
    async stop() {
      await killCurrent();
      current = undefined;
    },
  };
}
