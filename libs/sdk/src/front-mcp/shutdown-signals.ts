const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

const DEFAULT_SHUTDOWN_DEADLINE_MS = 10_000;

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
  logger?: { error(message: string, error?: unknown): void };
}

/**
 * On SIGTERM or SIGINT, run `shutdown` once and exit: code 0 when it completes, 1 when it fails
 * or outlasts the deadline (#712). The deadline timer is ref'd, so the process stays up while
 * the shutdown runs even after the server stops listening.
 *
 * @returns A function that removes the signal listeners
 */
export function exitOnShutdownSignals(shutdown: () => Promise<void>, options: ShutdownSignalOptions = {}): () => void {
  const target = options.target ?? process;
  const deadlineMs = options.deadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS;
  let shuttingDown = false;

  const onSignal = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => target.exit(1), deadlineMs);
    shutdown().then(
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

  for (const signal of SHUTDOWN_SIGNALS) target.on(signal, onSignal);
  return () => {
    for (const signal of SHUTDOWN_SIGNALS) target.removeListener(signal, onSignal);
  };
}
