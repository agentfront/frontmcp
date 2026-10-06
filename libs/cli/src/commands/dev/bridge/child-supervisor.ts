/**
 * Child supervisor for the dev bridge (issue #399).
 *
 * Owns the user-code subprocess. Spawns it, watches for the ready
 * sentinel (or a TCP probe in HTTP mode), restarts it on watcher events,
 * and surfaces lifecycle events to the state machine.
 *
 * The entry runs as `node --import <tsx loader> <entry>` — the server is the
 * direct child (#679). Going through `npx tsx` put npm and tsx between the
 * bridge and the server, so the IPC channel `--serve` needs never reached the
 * server and a restart could leave the old server holding the port. `npx -y
 * tsx` remains the HTTP-mode fallback when the project has no tsx installed.
 *
 * Two modes:
 *
 *   - **HTTP mode (default)**: the child boots a normal FrontMCP HTTP listener
 *     on the port the bridge exported as `PORT`. Readiness is the
 *     `__FRONTMCP_BOOTSTRAP_COMPLETE__` sentinel the SDK writes to stderr when
 *     `FRONTMCP_DEV_BOOTSTRAP_SENTINEL=1`; the SDK appends the port and MCP path
 *     it actually serves (a decorator can hard-code both). A TCP probe of the
 *     expected port covers SDKs that predate the sentinel.
 *
 *   - **Pipe mode (`--serve`)**: `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`.
 *     `FRONTMCP_DEV_STDIO_FD=3` + `FRONTMCP_STDIO=1` make the SDK serve MCP
 *     over the IPC channel. Readiness = first IPC message.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { pathToFileURL } from 'node:url';

import { processTreeSpawnOptions, stopProcessTree } from '../../../shared/process-tree';
import type { BridgeLogger } from './log';

export type SupervisorMode = 'http' | 'pipe';

/** Where the child says it serves MCP (HTTP mode). */
export interface ChildReadyInfo {
  port?: number;
  /** Unix socket the server listens on (`@FrontMcp({ http: { socketPath } })`) instead of a port. */
  socketPath?: string;
  /** MCP endpoint path, `/` for the root. */
  path?: string;
}

export interface ChildSupervisorOptions {
  mode: SupervisorMode;
  entry: string;
  log: BridgeLogger;
  /** Base env for the child (config overlays, `.env`, `PORT`). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Port for HTTP mode (TCP readiness probe). Ignored in pipe mode. */
  port?: number;
  /** Called once the child is ready to accept traffic. */
  onReady: (child: ChildProcess, info: ChildReadyInfo) => void | Promise<void>;
  /** Called when the child exits (expected or otherwise). */
  onExit: (reason: string) => void | Promise<void>;
  /** Max time to wait for a child to become ready before giving up. */
  readyTimeoutMs?: number;
  /** Resolves the tsx ESM loader for a TypeScript entry. Injectable for tests. */
  resolveTsxLoader?: () => string | undefined;
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

export const READY_SENTINEL = '__FRONTMCP_BOOTSTRAP_COMPLETE__';

/** After a TCP probe connects, how long to wait for the sentinel's port/path. */
const SENTINEL_GRACE_MS = 1500;

/**
 * Parse a stderr line carrying the bootstrap sentinel. Returns `undefined` when
 * the line has no sentinel, `{}` for a bare sentinel (older SDKs) and the
 * reported port (or Unix socket) and path otherwise.
 */
export function parseReadySentinel(line: string): ChildReadyInfo | undefined {
  const at = line.indexOf(READY_SENTINEL);
  if (at < 0) return undefined;
  const rest = line.slice(at + READY_SENTINEL.length).trim();
  if (!rest.startsWith('{')) return {};
  try {
    const parsed = JSON.parse(rest) as Record<string, unknown>;
    const info: ChildReadyInfo = {};
    if (typeof parsed['port'] === 'number' && Number.isInteger(parsed['port']) && parsed['port'] > 0) {
      info.port = parsed['port'];
    }
    if (typeof parsed['socketPath'] === 'string' && parsed['socketPath']) info.socketPath = parsed['socketPath'];
    if (typeof parsed['path'] === 'string') info.path = parsed['path'] || '/';
    return info;
  } catch {
    return {};
  }
}

/** Resolve the project's tsx loader (`tsx` package root export) as a `file:` URL. */
export function resolveProjectTsxLoader(cwd: string = process.cwd()): string | undefined {
  for (const base of [cwd, __dirname]) {
    try {
      return pathToFileURL(require.resolve('tsx', { paths: [base] })).href;
    } catch {
      // try the next base
    }
  }
  return undefined;
}

export interface ChildCommand {
  command: string;
  args: string[];
}

/** The command line that runs `entry` for the given mode. */
export function resolveChildCommand(
  entry: string,
  mode: SupervisorMode,
  resolveTsxLoader: () => string | undefined,
  platform: NodeJS.Platform = process.platform,
): ChildCommand {
  if (!/\.[cm]?tsx?$/i.test(entry)) {
    return { command: process.execPath, args: ['--conditions', 'node', entry] };
  }
  const loader = resolveTsxLoader();
  if (loader) {
    return { command: process.execPath, args: ['--conditions', 'node', '--import', loader, entry] };
  }
  if (mode === 'pipe') {
    // The IPC channel only reaches a process we spawn directly; through npx it
    // stops at npm and the server exits during boot.
    throw new Error(
      "`frontmcp dev --stdio --serve` runs a TypeScript entry with the project's tsx, which is not installed. " +
        'Install it (`npm i -D tsx`) or drop `--serve` to use the HTTP loopback.',
    );
  }
  return { command: platform === 'win32' ? 'npx.cmd' : 'npx', args: ['-y', 'tsx', '--conditions', 'node', entry] };
}

export function createChildSupervisor(options: ChildSupervisorOptions): ChildSupervisor {
  const { mode, entry, log, port, onReady, onExit, readyTimeoutMs = 30_000 } = options;
  const resolveTsxLoader = options.resolveTsxLoader ?? (() => resolveProjectTsxLoader());

  let current: ChildProcess | undefined;
  let killSignaled = false;

  function buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };
    // The stderr-bootstrap sentinel is an HTTP-mode signal only: in pipe
    // mode readiness MUST be the first IPC message from the child so we
    // know the FD-3 channel is wired up. Enabling the sentinel in pipe
    // mode lets probeReady() resolve before any IPC arrives and races
    // the first forwarded request.
    if (mode === 'http') env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'] = '1';
    if (mode === 'http' && port) env['PORT'] = String(port);
    if (mode === 'pipe') {
      env['FRONTMCP_DEV_STDIO_FD'] = '3';
      // Serve over the IPC channel instead of binding an HTTP port.
      env['FRONTMCP_STDIO'] = '1';
    }
    return env;
  }

  function spawnChild(): ChildProcess {
    const { command, args } = resolveChildCommand(entry, mode, resolveTsxLoader);
    // Pipe mode pairs an IPC channel as FD 3 so the child can read/write
    // JSON frames there. Node sets up the IPC machinery automatically when
    // 'ipc' is the 4th stdio entry. Each child leads its own process group
    // so a restart takes down everything the server started (#679).
    return spawn(command, args, {
      stdio: mode === 'http' ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'ipc'],
      env: buildEnv(),
      ...processTreeSpawnOptions(),
    });
  }

  async function probeReady(child: ChildProcess): Promise<ChildReadyInfo> {
    return new Promise<ChildReadyInfo>((resolve, reject) => {
      let resolved = false;
      let stderrBuffer = '';
      let graceTimer: NodeJS.Timeout | undefined;

      const finish = (info: ChildReadyInfo): void => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(info);
      };

      const cleanup = (): void => {
        clearTimeout(deadlineTimer);
        if (graceTimer) clearTimeout(graceTimer);
        if (tcpProbeTimer) clearInterval(tcpProbeTimer);
        child.stderr?.off('data', onStderr);
        child.off('message', onMessage);
        child.off('exit', onExitDuringBoot);
        child.off('error', onSpawnError);
      };

      const deadlineTimer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`child did not become ready within ${readyTimeoutMs}ms`));
      }, readyTimeoutMs).unref();

      const onStderr = (chunk: Buffer | string): void => {
        // Sentinel-on-stderr is only meaningful in HTTP mode (buildEnv
        // sets `FRONTMCP_DEV_BOOTSTRAP_SENTINEL=1` only there). In pipe
        // mode readiness comes from the first IPC message — ignore any
        // stderr signal so we don't race the IPC handshake.
        if (mode !== 'http') return;
        stderrBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        let nl: number;
        while ((nl = stderrBuffer.indexOf('\n')) >= 0) {
          const line = stderrBuffer.slice(0, nl);
          stderrBuffer = stderrBuffer.slice(nl + 1);
          const info = parseReadySentinel(line);
          if (info) {
            finish(info);
            return;
          }
        }
      };
      child.stderr?.on('data', onStderr);

      const onMessage = (): void => {
        // First IPC message from the child counts as ready in pipe mode.
        if (mode === 'pipe') finish({});
      };
      if (mode === 'pipe') child.on('message', onMessage);

      const onExitDuringBoot = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`child exited during boot: code=${code} signal=${signal ?? 'null'}`));
      };
      child.once('exit', onExitDuringBoot);

      const onSpawnError = (err: Error): void => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`child failed to start: ${err.message}`));
      };
      child.once('error', onSpawnError);

      // HTTP mode fallback for SDKs without the sentinel: the expected port
      // accepting connections counts as ready — after a short grace period in
      // which a sentinel can still report the real port/path.
      const tcpProbeTimer =
        mode === 'http' && port
          ? setInterval(() => {
              if (resolved || graceTimer) return;
              const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
                sock.end();
                if (resolved || graceTimer) return;
                graceTimer = setTimeout(() => finish({}), SENTINEL_GRACE_MS).unref();
              });
              sock.once('error', () => sock.destroy());
              sock.setTimeout(500, () => sock.destroy());
            }, 250).unref()
          : undefined;
    });
  }

  async function killCurrent(): Promise<void> {
    if (!current) return;
    killSignaled = true;
    await stopProcessTree(current, 'SIGTERM', 2000);
    killSignaled = false;
  }

  function wireExitHandler(child: ChildProcess): void {
    // A spawn failure (e.g. ENOENT) is reported here; without a listener it
    // would crash the bridge.
    child.on('error', (err) => log.error('child-error', { error: err.message }));
    child.once('exit', (code, signal) => {
      const reason = killSignaled ? 'killed-for-restart' : `code=${code ?? 'null'} signal=${signal ?? 'null'}`;
      log.warn('child-exited', { reason });
      void onExit(reason);
    });
    // Forward the child's output to the log file (never to our stdout, which
    // carries JSON-RPC). Draining stdout also keeps a chatty server from
    // blocking once the pipe buffer is full.
    const forward = (stream: 'child-stdout' | 'child-stderr') => (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        if (line.includes(READY_SENTINEL)) continue;
        log.info(stream, { line: line.slice(0, 500) });
      }
    };
    child.stdout?.on('data', forward('child-stdout'));
    child.stderr?.on('data', forward('child-stderr'));
  }

  async function launch(event: 'child-ready' | 'child-restart-ready'): Promise<void> {
    const child = spawnChild();
    current = child;
    wireExitHandler(child);
    // Clean up the spawned subprocess on any startup failure
    // (probeReady timeout, onReady throw). Without this, a failed
    // start would leave the child running and occupying the dev port
    // or the IPC channel, breaking the next restart.
    try {
      const info = await probeReady(child);
      log.info(event, { mode, pid: child.pid ?? null, ...info });
      await onReady(child, info);
    } catch (err) {
      await killCurrent();
      current = undefined;
      throw err;
    }
  }

  return {
    current: () => current,
    async start() {
      log.info('child-spawn', { mode, entry, port: port ?? null });
      await launch('child-ready');
    },
    async restart() {
      log.info('child-restart-start');
      await killCurrent();
      current = undefined;
      await launch('child-restart-ready');
    },
    async stop() {
      await killCurrent();
      current = undefined;
    },
  };
}
