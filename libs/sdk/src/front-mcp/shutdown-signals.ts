import type { Readable } from 'node:stream';

import { watchParent, type ParentGoneReason, type ProcessWatcher } from '@frontmcp/utils';

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

const ORPHANED_MESSAGES: Record<ParentGoneReason, string> = {
  'parent-exited': 'The parent process exited; shutting down',
  'stdin-ended': 'stdin ended; shutting down',
};

export const DEFAULT_SHUTDOWN_DEADLINE_MS = 10_000;

/** A stdio client waits on the process to exit, so stdio keeps its shorter deadline. */
export const STDIO_SHUTDOWN_DEADLINE_MS = 5_000;

/** How long a stdio server whose stdin ended waits for the replies it still owes before it shuts down. */
export const STDIO_DRAIN_MS = 2_000;

/** What started the shutdown: a signal, or the process being orphaned (`lifecycle.exitWhenOrphaned`). */
export type ShutdownTrigger = 'signal' | ParentGoneReason;

interface SignalTarget {
  on(signal: string, listener: () => void): unknown;
  removeListener(signal: string, listener: () => void): unknown;
  exit(code: number): unknown;
}

export interface ShutdownSignalOptions {
  /** The process to listen on and exit (default: the current process). */
  target?: SignalTarget;
  /** How long the shutdown may take before the process exits with code 1. */
  deadlineMs?: number;
  logger?: { error(message: string, error?: unknown): void; info?(message: string): void };
  /** Also shut down when the parent process exits or, when given, `stdin` ends (`lifecycle.exitWhenOrphaned`). */
  whenOrphaned?: { stdin?: Readable };
}

/**
 * On SIGTERM or SIGINT, run `shutdown` once and exit: code 0 when it completes, 1 when it fails
 * or outlasts the deadline (#712). The deadline timer is ref'd, so the process stays up while
 * the shutdown runs even after the server stops listening. With `whenOrphaned`, the parent
 * exiting (or stdin ending) does the same. `shutdown` is told which of them started it.
 *
 * @returns A function that removes the signal listeners and stops watching the parent
 */
export function exitOnShutdownSignals(
  shutdown: (trigger: ShutdownTrigger) => Promise<void>,
  options: ShutdownSignalOptions = {},
): () => void {
  const target = options.target ?? process;
  const deadlineMs = options.deadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS;
  let shuttingDown = false;
  let watcher: ProcessWatcher | undefined;

  const begin = (trigger: ShutdownTrigger): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    watcher?.close();
    const deadline = setTimeout(() => target.exit(1), deadlineMs);
    shutdown(trigger).then(
      () => {
        clearTimeout(deadline);
        target.exit(0);
      },
      (error: unknown) => {
        clearTimeout(deadline);
        options.logger?.error('Graceful shutdown failed', error);
        target.exit(1);
      },
    );
  };

  const onSignal = (): void => begin('signal');

  for (const signal of SHUTDOWN_SIGNALS) target.on(signal, onSignal);
  if (options.whenOrphaned) {
    watcher = watchParent({
      stdin: options.whenOrphaned.stdin,
      onGone: (reason) => {
        options.logger?.info?.(ORPHANED_MESSAGES[reason]);
        begin(reason);
      },
    });
  }
  return () => {
    watcher?.close();
    for (const signal of SHUTDOWN_SIGNALS) target.removeListener(signal, onSignal);
  };
}
