/** The `spawnOwned` marker of detached job runners, for `reapOrphans(JOB_WORKER_MARKER)`. */
export const JOB_WORKER_MARKER = 'frontmcp-job';

/** Set in a detached runner's environment to the run it is started for. */
export const RUN_JOB_ENV_VAR = 'FRONTMCP_RUN_JOB_ID';

/** Set on the config a detached runner boots, so its scopes run that run and reconcile nothing. */
export const JOB_WORKER_FLAG = '__jobWorker' as const;

/** Set by the entries that hand a detached runner over to its run (`bootstrap()`, `runStdio()`, `runUnixSocket()`). */
const ENTRY_SERVER_FLAG = '__entryServer';

/** The run a detached runner was started for, from its environment. */
export function detachedJobRunId(): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env?.[RUN_JOB_ENV_VAR];
}

/** Whether a scope's config was booted by a detached runner. */
export function isJobWorker(metadata: object): boolean {
  return (metadata as Record<string, unknown>)[JOB_WORKER_FLAG] === true;
}

/** Mark a config as served by an entry a detached runner can run again. */
export function markEntryServer(config: object): void {
  (config as Record<string, unknown>)[ENTRY_SERVER_FLAG] = true;
}

/** Whether a scope's server was started by an entry a detached runner can run again. */
export function isEntryServer(metadata: object): boolean {
  return (metadata as Record<string, unknown>)[ENTRY_SERVER_FLAG] === true;
}
