import { PublicMcpError } from '@frontmcp/sdk';

import type { CodeCallPausedRunRecord, CodeCallRunCaller, CodeCallRunStore } from '../runs/run-record.store';

/** A run the caller cannot read: it expired, was never kept, or is another caller's. */
export function runNotFoundError(runId: string): PublicMcpError {
  return new PublicMcpError(
    `Run "${runId}" was not found: it expired, was never kept, or belongs to another caller`,
    'RUN_NOT_FOUND',
    404,
  );
}

/** A run that is not paused, so it cannot be resumed or cancelled. */
export function runNotPausedError(runId: string, status: string): PublicMcpError {
  return new PublicMcpError(`Run "${runId}" is not paused: it is ${status}`, 'RUN_NOT_PAUSED', 409);
}

/** The caller's paused run `runId`, or the error that says why it cannot be resumed or cancelled. */
export async function readPausedRun(
  runs: CodeCallRunStore,
  runId: string,
  caller: CodeCallRunCaller,
): Promise<CodeCallPausedRunRecord> {
  const paused = await runs.readPaused(runId, caller);
  if (paused) return paused;
  const record = await runs.read(runId, caller);
  if (!record || record.status === 'paused') throw runNotFoundError(runId);
  throw runNotPausedError(runId, record.status);
}

/** Claims the run's pause for this caller, once, until it expires; a run already claimed is being resumed. */
export async function claimPausedRun(
  runs: CodeCallRunStore,
  run: CodeCallPausedRunRecord,
  caller: CodeCallRunCaller,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((Date.parse(run.pause.expiresAt) - Date.now()) / 1000));
  if (!(await runs.claim(run.runId, caller, run.pause.id, ttlSeconds))) {
    throw runNotPausedError(run.runId, 'being resumed or was cancelled');
  }
}
