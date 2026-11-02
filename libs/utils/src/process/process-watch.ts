/**
 * Watchers that tell a long-lived process its reason to run is gone: its parent exited, its stdin ended, or a
 * directory it serves was removed. Their timers are unref'd, so they never keep the process alive.
 *
 * **Node.js only.**
 */

import { fileExistsSync } from '../fs/fs';
import { isPidRunning, type ProcessTreeDeps } from './process-tree';

const DEFAULT_INTERVAL_MS = 1000;

export type ParentGoneReason = 'parent-exited' | 'stdin-ended';

export interface ProcessWatcher {
  /** Stop watching. Safe to call more than once. */
  close(): void;
}

export interface WatchParentOptions {
  /** Called once, when the parent is gone. */
  onGone: (reason: ParentGoneReason) => void;
  /** How often the parent is checked. @default 1000 */
  intervalMs?: number;
  /** A stream whose end also counts as the parent going away, such as `process.stdin` for a stdio server. */
  stdin?: NodeJS.ReadableStream;
}

export interface WatchParentDeps extends Pick<ProcessTreeDeps, 'kill'> {
  ppid: () => number;
}

export interface WatchPathOptions {
  /** Called once, when the path no longer exists. */
  onGone: () => void;
  /** How often the path is checked. @default 1000 */
  intervalMs?: number;
}

/**
 * Report when this process's parent is gone: this process was handed to another parent (the parent pid changed),
 * or the parent pid no longer runs (Windows does not reparent). A process started by init has no parent to watch,
 * so only `stdin` is watched then.
 */
export function watchParent(options: WatchParentOptions, deps?: Partial<WatchParentDeps>): ProcessWatcher {
  const d: WatchParentDeps = { ppid: () => process.ppid, kill: (pid, signal) => process.kill(pid, signal), ...deps };
  const parentPid = d.ppid();
  const stdin = options.stdin;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const close = (): void => {
    closed = true;
    clearInterval(timer);
    stdin?.removeListener('end', onStdinEnded);
    stdin?.removeListener('close', onStdinEnded);
  };
  const report = (reason: ParentGoneReason): void => {
    if (closed) return;
    close();
    options.onGone(reason);
  };
  function onStdinEnded(): void {
    report('stdin-ended');
  }

  stdin?.once('end', onStdinEnded);
  stdin?.once('close', onStdinEnded);
  if (parentPid > 1) {
    timer = setInterval(() => {
      if (d.ppid() !== parentPid || !isPidRunning(parentPid, d)) report('parent-exited');
    }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    timer.unref();
  }
  return { close };
}

/** Report when `path` no longer exists, for example a checkout that was deleted. */
export function watchPath(path: string, options: WatchPathOptions): ProcessWatcher {
  const timer = setInterval(() => {
    if (fileExistsSync(path)) return;
    clearInterval(timer);
    options.onGone();
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();
  return { close: () => clearInterval(timer) };
}
