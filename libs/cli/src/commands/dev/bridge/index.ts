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
 *   1. Parse options, resolve entry + log file path.
 *   2. Pin a stable session id (uuid) so the same id survives child
 *      restarts.
 *   3. Construct logger; open log file.
 *   4. Construct state machine + framer + watcher + supervisor +
 *      upstream client (transport per `--serve`).
 *   5. Spawn the first child, wait for ready, transition state to Ready.
 *   6. Forward frames in both directions; watcher events trigger
 *      controlled restart.
 *   7. SIGINT/SIGTERM → flush buffer with `dev_server_unreachable`,
 *      tear down child + watcher, exit cleanly.
 */

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

import type { ParsedArgs } from '../../../core/args';
import { resolveEntry } from '../../../shared/fs';
import { createChildSupervisor, type ChildSupervisor, type SupervisorMode } from './child-supervisor';
import { createBridgeLogger, type BridgeLogger } from './log';
import { createBridgeStateMachine, type BridgeStateMachine } from './state-machine';
import { createStdioFramer, type JsonRpcFrame, type StdioFramer } from './stdio-framer';
import { createHttpUpstream, createPipeUpstream, type UpstreamClient } from './upstream-client';
import { createDevWatcher, type DevWatcher } from './watcher';

interface RuntimeBridgeOptions {
  entry: string;
  mode: SupervisorMode;
  port: number;
  bufferSize: number;
  reloadDeadlineMs: number;
  logFile: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_LOG_FILE = path.join('.frontmcp', 'dev.log');

function normalizeOptions(opts: ParsedArgs, entry: string): RuntimeBridgeOptions {
  const mode: SupervisorMode = opts.serve ? 'pipe' : 'http';
  const port = typeof opts.port === 'number' ? opts.port : DEFAULT_PORT;
  const bufferSize = typeof opts.bufferSize === 'number' && opts.bufferSize > 0 ? opts.bufferSize : 8;
  const reloadDeadlineMs =
    typeof opts.reloadDeadlineMs === 'number' && opts.reloadDeadlineMs > 0 ? opts.reloadDeadlineMs : 30_000;
  const logFile = typeof opts.logFile === 'string' && opts.logFile.length > 0 ? opts.logFile : DEFAULT_LOG_FILE;
  return { entry, mode, port, bufferSize, reloadDeadlineMs, logFile };
}

export async function runDevBridge(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);
  const runtime = normalizeOptions(opts, entry);

  const log = await createBridgeLogger({ filePath: runtime.logFile });
  log.info('bridge-start', {
    entry: runtime.entry,
    mode: runtime.mode,
    port: runtime.port,
    bufferSize: runtime.bufferSize,
    reloadDeadlineMs: runtime.reloadDeadlineMs,
  });

  // Pinned session id — child reads from FRONTMCP_DEV_FORCE_SESSION_ID so
  // session continuity works across restarts (memory or Redis store both OK).
  const sessionId = randomUUID();

  // Only `upstream` is reassigned during runtime (on every child restart).
  // The rest are constructed exactly once below and referenced through
  // closures that fire after all bindings exist.
  let upstream: UpstreamClient | undefined;

  function buildUpstreamForChild(child: ChildProcess): UpstreamClient {
    if (runtime.mode === 'http') {
      return createHttpUpstream({
        url: `http://127.0.0.1:${runtime.port}/`,
        log,
        sessionId,
        onFrame: (frame: JsonRpcFrame) => fsm.relayUpstream(frame),
      });
    }
    return createPipeUpstream({
      child,
      log,
      sessionId,
      onFrame: (frame: JsonRpcFrame) => fsm.relayUpstream(frame),
    });
  }

  // ─── construct framer + FSM. Closures bind to each other by reference,
  // so referencing `fsm`/`framer` inside a callback executed at runtime
  // is safe even though `framer` is declared first textually. ───
  const framer = createStdioFramer({
    input: process.stdin,
    output: process.stdout,
    log,
    onFrame: (frame) => fsm.enqueue(frame),
  });

  const fsm = createBridgeStateMachine({
    log,
    bufferSize: runtime.bufferSize,
    reloadDeadlineMs: runtime.reloadDeadlineMs,
    respond: (frame) => framer.write(frame),
    forward: async (frame) => {
      if (!upstream) {
        log.warn('forward-without-upstream', { method: frame.method });
        return;
      }
      await upstream.send(frame);
    },
  });

  framer.start();

  // ─── supervisor → boots first child, then attaches upstream ───
  const supervisor = createChildSupervisor({
    mode: runtime.mode,
    entry: runtime.entry,
    log,
    sessionId,
    port: runtime.mode === 'http' ? runtime.port : undefined,
    onReady: async (child) => {
      // Close any previous upstream (reload path).
      await upstream?.close();
      upstream = buildUpstreamForChild(child);
      fsm.onChildReady();
    },
    onExit: (reason) => {
      void upstream?.close();
      upstream = undefined;
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
  const watchRoot = path.dirname(path.resolve(runtime.entry));
  const watcher = createDevWatcher({
    rootDir: watchRoot,
    log,
    onChange: (trigger) => {
      fsm.onWatcherEvent(trigger);
      void (async () => {
        try {
          await supervisor!.restart();
        } catch (err) {
          log.error('restart-failed', { error: (err as Error).message });
        }
      })();
    },
  });
  watcher.start();

  // ─── teardown wiring ───
  let stopping = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
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
    process.exit(0);
  }

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  // Bridge runs until SIGINT/SIGTERM — keep the event loop alive via the
  // open stdin + watcher.
}

export { type BridgeLogger, type BridgeStateMachine, type ChildSupervisor, type StdioFramer, type UpstreamClient };
