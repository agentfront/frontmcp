/**
 * Cross-platform process liveness probe.
 *
 * `process.kill(pid, 0)` is the canonical "is this PID alive" check on POSIX.
 * It sends no signal but throws `ESRCH` if the PID is gone. Windows also
 * supports it via Node's `process.kill` polyfill (reports the target's
 * existence via the same error semantics).
 *
 * Used by `CliTaskRunner.cancel` and by `SqliteTaskStore` orphan detection to
 * decide whether a `working`/`input_required` task is still being executed.
 *
 * @module task/helpers/process-liveness
 */

/** Returns `true` if a process with the given PID is alive and accessible. */
export function isAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // EPERM means the process exists but we lack permission to signal it —
    // still "alive" for our purposes.
    if (code === 'EPERM') return true;
    return false;
  }
}
