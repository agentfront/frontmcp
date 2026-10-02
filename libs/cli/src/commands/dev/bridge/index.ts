/**
 * Dev stdio bridge entry point (issue #399).
 *
 * Wires the framer (stdio in/out), state machine (buffer + reload FSM),
 * watcher (file-change source), child supervisor (user-code lifecycle),
 * and upstream client (forwarding to the child) into a single
 * long-lived process.
 *
 * Lifetime:
 *
 *   1. Resolve config, project root, entry, port and child env exactly like
 *      `frontmcp dev` (#679 — the bridge used to ignore all of them).
 *   2. Construct logger; open log file.
 *   3. Construct state machine + framer + watcher + supervisor +
 *      upstream client (transport per `--serve`).
 *   4. Spawn the first child, wait for ready, transition state to Ready.
 *   5. Forward frames in both directions. The client's `initialize` is
 *      remembered; after a restart it is replayed against the new child
 *      before buffered requests drain, so the client never re-connects.
 *   6. SIGINT/SIGTERM → flush buffer with `dev_server_unreachable`,
 *      tear down child + watcher, exit cleanly.
 */

import type { ChildProcess } from 'node:child_process';
import * as path from 'node:path';

import type { ParsedArgs } from '../../../core/args';
import { resolveDevLaunch } from '../dev';
import {
  createChildSupervisor,
  resolveChildCommand,
  resolveProjectTsxLoader,
  type ChildReadyInfo,
  type ChildSupervisor,
  type SupervisorMode,
} from './child-supervisor';
import { createBridgeLogger, type BridgeLogger } from './log';
import { createBridgeStateMachine, type BridgeStateMachine } from './state-machine';
import { createStdioFramer, type JsonRpcFrame, type StdioFramer } from './stdio-framer';
import { createHttpUpstream, createPipeUpstream, type UpstreamClient } from './upstream-client';
import { createDevWatcher } from './watcher';

interface RuntimeBridgeOptions {
  mode: SupervisorMode;
  bufferSize: number;
  reloadDeadlineMs: number;
  logFile: string;
}

const DEFAULT_LOG_FILE = path.join('.frontmcp', 'dev.log');

/** `list_changed` notifications a reload may warrant, keyed by capability. */
const LIST_CHANGED = {
  tools: 'notifications/tools/list_changed',
  resources: 'notifications/resources/list_changed',
  prompts: 'notifications/prompts/list_changed',
} as const;

function normalizeOptions(opts: ParsedArgs): RuntimeBridgeOptions {
  const mode: SupervisorMode = opts.serve ? 'pipe' : 'http';
  const bufferSize = typeof opts.bufferSize === 'number' && opts.bufferSize > 0 ? opts.bufferSize : 8;
  const reloadDeadlineMs =
    typeof opts.reloadDeadlineMs === 'number' && opts.reloadDeadlineMs > 0 ? opts.reloadDeadlineMs : 30_000;
  const logFile = typeof opts.logFile === 'string' && opts.logFile.length > 0 ? opts.logFile : DEFAULT_LOG_FILE;
  return { mode, bufferSize, reloadDeadlineMs, logFile };
}

/** `''` / `'mcp'` / `'/mcp/'` → `/` / `/mcp` / `/mcp` — the path the SDK mounts. */
export function mcpPathOf(entryPath: string | undefined): string {
  const trimmed = (entryPath ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '/';
}

/** The `list_changed` notifications the capabilities of a fresh child advertise. */
export function listChangedNotifications(initializeResult: Record<string, unknown> | undefined): JsonRpcFrame[] {
  const capabilities = initializeResult?.['capabilities'];
  if (typeof capabilities !== 'object' || capabilities === null) return [];
  const frames: JsonRpcFrame[] = [];
  for (const [capability, method] of Object.entries(LIST_CHANGED)) {
    const entry = (capabilities as Record<string, unknown>)[capability];
    if (typeof entry === 'object' && entry !== null && (entry as { listChanged?: unknown }).listChanged === true) {
      frames.push({ jsonrpc: '2.0', method });
    }
  }
  return frames;
}

export async function runDevBridge(opts: ParsedArgs): Promise<void> {
  const runtime = normalizeOptions(opts);
  // stdout carries JSON-RPC frames only: port notices go to stderr.
  const launch = await resolveDevLaunch(opts, {
    autoPortWhenUnset: true,
    listens: runtime.mode === 'http',
    log: (msg) => process.stderr.write(`${msg}\n`),
  });
  // A relative --log-file was made absolute by resolveDevLaunch when the
  // command moved to the project root.
  const logFile =
    typeof opts.logFile === 'string' && opts.logFile.length > 0 && launch.movedFrom
      ? path.resolve(launch.movedFrom, opts.logFile)
      : runtime.logFile;
  // Fail fast (on stderr, before taking over stdio) when the entry cannot run
  // in this mode — e.g. `--serve` without tsx.
  resolveChildCommand(launch.entry, runtime.mode, () => resolveProjectTsxLoader(launch.cwd));

  const log = await createBridgeLogger({ filePath: logFile });
  log.info('bridge-start', {
    entry: launch.entry,
    cwd: launch.cwd,
    mode: runtime.mode,
    port: runtime.mode === 'http' ? launch.port : null,
    bufferSize: runtime.bufferSize,
    reloadDeadlineMs: runtime.reloadDeadlineMs,
  });

  // The client's handshake, replayed on every restarted child.
  let clientInitialize: JsonRpcFrame | undefined;
  let clientInitialized = false;

  // Only `upstream` is reassigned during runtime (on every child restart).
  // The rest are constructed exactly once below and referenced through
  // closures that fire after all bindings exist.
  let upstream: UpstreamClient | undefined;

  function buildUpstreamForChild(child: ChildProcess, info: ChildReadyInfo): UpstreamClient {
    if (runtime.mode === 'http') {
      // The child reports where it serves (a decorator may hard-code the port
      // or path); fall back to what we told it.
      const url = `http://127.0.0.1:${info.port ?? launch.port}${info.path ?? mcpPathOf(launch.configHttpPath)}`;
      log.info('upstream-url', { url });
      return createHttpUpstream({ url, log, onFrame: (frame: JsonRpcFrame) => fsm.relayUpstream(frame) });
    }
    return createPipeUpstream({ child, log, onFrame: (frame: JsonRpcFrame) => fsm.relayUpstream(frame) });
  }

  // Teardown needs the supervisor + watcher, which are built after the framer.
  // If stdin closes while the first child is still booting, shutdown is
  // deferred until `teardownReady` flips.
  let stdinClosed = false;
  let teardownReady = false;

  // ─── construct framer + FSM. Closures bind to each other by reference,
  // so referencing `fsm`/`framer` inside a callback executed at runtime
  // is safe even though `framer` is declared first textually. ───
  const framer = createStdioFramer({
    input: process.stdin,
    output: process.stdout,
    log,
    onFrame: (frame) => fsm.enqueue(frame),
    // The MCP client closed our stdin (or died): nothing can talk to us any
    // more, so tear the child down instead of leaving it orphaned.
    onClose: () => {
      stdinClosed = true;
      if (teardownReady) void shutdown('stdin-closed');
    },
  });

  const fsm = createBridgeStateMachine({
    log,
    bufferSize: runtime.bufferSize,
    reloadDeadlineMs: runtime.reloadDeadlineMs,
    respond: (frame) => framer.write(frame),
    forward: async (frame) => {
      if (frame.method === 'initialize' && frame.id !== undefined && frame.id !== null) {
        clientInitialize = frame;
        clientInitialized = false;
      } else if (frame.method === 'notifications/initialized') {
        clientInitialized = true;
      }
      if (!upstream) {
        log.warn('forward-without-upstream', { method: frame.method });
        return;
      }
      await upstream.send(frame);
    },
  });

  framer.start();

  // ─── supervisor → boots first child, then attaches upstream ───
  const supervisor: ChildSupervisor = createChildSupervisor({
    mode: runtime.mode,
    entry: launch.entry,
    log,
    env: launch.childEnv,
    port: runtime.mode === 'http' ? launch.port : undefined,
    resolveTsxLoader: () => resolveProjectTsxLoader(launch.cwd),
    onReady: async (child, info) => {
      // Close any previous upstream (reload path). A rejection here MUST
      // NOT block re-binding — the child is up and ready, and leaving the
      // bridge without an upstream would strand every subsequent RPC.
      try {
        await upstream?.close();
      } catch (err) {
        log.error('upstream-stop-error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const next = buildUpstreamForChild(child, info);
      // The client's handshake went to an earlier child: this one knows
      // nothing of it. Replay it first, so buffered requests land in an
      // initialized session.
      if (clientInitialize) {
        try {
          const result = await next.reinitialize(clientInitialize, clientInitialized);
          log.info('client-handshake-replayed');
          // The new code may expose different tools/resources/prompts.
          for (const notification of listChangedNotifications(result)) await framer.write(notification);
        } catch (err) {
          log.error('client-handshake-replay-failed', { error: err instanceof Error ? err.message : String(err) });
          // A child without the client's session cannot serve the buffered
          // requests (HTTP answers 404 for the unknown session). Fail the
          // launch instead: the supervisor stops this child and the FSM stays
          // in its reload path — buffered requests wait for the next good
          // child or get `dev_reload_deadline`.
          await next.close().catch(() => undefined);
          throw err;
        }
      }
      upstream = next;
      fsm.onChildReady();
    },
    onExit: (reason) => {
      // Don't drop the close() promise — an in-flight HTTP request or SSE
      // body read can reject (e.g. AbortError when we abort it ourselves),
      // and an unhandled rejection here would crash the bridge on the
      // next tick. Hand the rejection to the logger; the child is dead
      // either way so we always proceed to onChildExit.
      const closingUpstream = upstream;
      upstream = undefined;
      void closingUpstream?.close().catch((err: unknown) => {
        log.error('upstream-stop-error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      fsm.onChildExit(reason);
    },
  });

  fsm.onBootStart();

  try {
    await supervisor.start();
  } catch (err) {
    log.error('initial-boot-failed', { error: (err as Error).message });
    fsm.onReloadDeadline();
    // Stay running so the watcher can retry once the user fixes the source.
  }

  // ─── watcher → restart on file change ───
  // Watch the project root, not just the entry's directory: shared
  // helpers, `frontmcp.config.ts`, and `tsconfig.json` all live above
  // `src/main.ts` and must trigger a reload too. The recursive watcher
  // already debounces and filters via `shouldIgnore` so the wider scope
  // doesn't generate spurious reloads.
  const watcher = createDevWatcher({
    rootDir: launch.cwd,
    log,
    onChange: (trigger) => {
      fsm.onWatcherEvent(trigger);
      void (async () => {
        try {
          await supervisor.restart();
        } catch (err) {
          log.error('restart-failed', { error: (err as Error).message });
        }
      })();
    },
  });
  watcher.start();

  // ─── teardown wiring ───
  let stopping = false;
  let resolveStopped: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  async function shutdown(signal: NodeJS.Signals | 'stdin-closed'): Promise<void> {
    if (stopping) return;
    stopping = true;
    log.info('bridge-stop', { signal });
    try {
      await fsm.stop();
    } catch (err) {
      log.error('fsm-stop-error', { error: (err as Error).message });
    }
    try {
      watcher.stop();
    } catch (err) {
      log.error('watcher-stop-error', { error: (err as Error).message });
    }
    try {
      await upstream?.close();
    } catch (err) {
      log.error('upstream-stop-error', { error: (err as Error).message });
    }
    try {
      await supervisor.stop();
    } catch (err) {
      log.error('supervisor-stop-error', { error: (err as Error).message });
    }
    framer.stop();
    await log.close();
    resolveStopped();
  }

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  teardownReady = true;
  if (stdinClosed) void shutdown('stdin-closed');

  // The bridge is long-lived: resolve only once it has shut down (signal or
  // stdin closed). Returning earlier lets the CLI entry point exit the
  // process straight away and orphan the dev server child.
  await stopped;
}

export { type BridgeLogger, type BridgeStateMachine, type ChildSupervisor, type StdioFramer, type UpstreamClient };
