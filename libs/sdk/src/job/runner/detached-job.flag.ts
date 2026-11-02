/** Set in a detached runner's environment to the run it is started for. */
export const RUN_JOB_ENV_VAR = 'FRONTMCP_RUN_JOB_ID';

/** Set on the config a detached runner boots, so its scopes run that run and reconcile nothing. */
export const JOB_WORKER_FLAG = '__jobWorker' as const;

/** The run a detached runner was started for, from its environment. */
export function detachedJobRunId(): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env?.[RUN_JOB_ENV_VAR];
}

/** Whether a scope's config was booted by a detached runner. */
export function isJobWorker(metadata: object): boolean {
  return (metadata as Record<string, unknown>)[JOB_WORKER_FLAG] === true;
}
