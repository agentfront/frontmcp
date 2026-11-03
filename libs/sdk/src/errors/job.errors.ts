import { InternalMcpError, PublicMcpError } from './mcp.error';

/**
 * The caller may not perform this action on the job or workflow
 * (GHSA-58v2-gpcc-jmqv).
 *
 * The message deliberately does NOT distinguish "exists but you may not touch
 * it" from "does not exist": both `execute_job` on a restricted job and
 * `execute_job` on a typo must read the same, or the error itself becomes an
 * enumeration oracle for the restricted job names on a server.
 */
export class JobNotAuthorizedError extends PublicMcpError {
  /** The requested name, for internal logs only — never surfaced publicly. */
  readonly requestedName: string;

  constructor(requestedName: string) {
    super(`Job or workflow "${requestedName}" not found or not permitted`, 'JOB_NOT_AUTHORIZED', 403);
    this.requestedName = requestedName;
  }
}

/**
 * Dynamic job/workflow registration was attempted while it is disabled.
 *
 * `register_job` takes a raw script string and registers it as an executable
 * job, so it stays off unless an operator explicitly opts in with
 * `jobs: { allowDynamicRegistration: true }`.
 */
export class DynamicJobRegistrationDisabledError extends PublicMcpError {
  constructor(kind: 'job' | 'workflow' = 'job') {
    super(
      `Dynamic ${kind} registration is disabled. Enable it with jobs: { allowDynamicRegistration: true }.`,
      'DYNAMIC_REGISTRATION_DISABLED',
      403,
    );
  }
}

/** An attempt of a job ran past its `timeout` (or `jobs.defaultTimeoutMs`); a run whose last attempt did is `timed_out`. */
export class JobTimeoutError extends PublicMcpError {
  constructor(jobName: string, timeoutMs: number) {
    super(`Job "${jobName}" timed out after ${timeoutMs} ms`, 'JOB_TIMEOUT', 504);
  }
}

/** The run was cancelled with `cancel_job`; the run is `cancelled`. */
export class JobCancelledError extends PublicMcpError {
  constructor(runId: string) {
    super(`Run "${runId}" was cancelled`, 'JOB_CANCELLED', 409);
  }
}

/** The run stopped before it finished because its process went away; the run is `interrupted`. */
export class JobInterruptedError extends PublicMcpError {
  constructor(runId: string, why = 'the server shut down') {
    super(`Run "${runId}" was interrupted: ${why}`, 'JOB_INTERRUPTED', 503);
  }
}

/** The job's runner cannot run here: a detached run needs a Node server started from its entry and a shared store. */
export class JobRunnerUnavailableError extends PublicMcpError {
  constructor(jobName: string, why: string, remedy: string) {
    super(`Job "${jobName}" cannot use its runner: ${why}`, 'JOB_RUNNER_UNAVAILABLE', 501, undefined, {
      say: remedy,
    });
  }
}

/** The process of a detached run could not start, or exited before it took the run over; the run is `failed`. */
export class JobRunnerBootError extends PublicMcpError {
  constructor(runId: string, cause: string) {
    super(`The detached runner of run "${runId}" did not start: ${cause}`, 'JOB_RUNNER_BOOT_FAILED', 503, undefined, {
      say: 'Run the job again; if it keeps failing, check that the server starts from its entry',
      tool: 'execute_job',
    });
  }
}

/** An attempt waited `jobs.admission.maxWaitMs` for a slot and was not admitted. */
export class JobAdmissionTimeoutError extends PublicMcpError {
  constructor(jobName: string, maxWaitMs: number, waitedFor: string) {
    super(
      `Job "${jobName}" waited ${maxWaitMs} ms to start and was not admitted: ${waitedFor}`,
      'JOB_ADMISSION_TIMEOUT',
      503,
      undefined,
      {
        say: 'Retry once fewer job runs are active, or ask the operator to raise jobs.admission',
      },
    );
  }
}

/** No run with this id, or one the caller may not see: both read the same, so run ids cannot be probed. */
export class JobRunNotFoundError extends PublicMcpError {
  constructor(runId: string) {
    super(`Run "${runId}" not found`, 'JOB_RUN_NOT_FOUND', 404, undefined, {
      say: 'Use a runId that execute_job returned to you',
    });
  }
}

/** The run already ended, so there is nothing to cancel. */
export class JobRunFinishedError extends PublicMcpError {
  constructor(runId: string, state: string) {
    super(`Run "${runId}" already finished as ${state}`, 'JOB_RUN_FINISHED', 409, undefined, {
      say: 'Read its outcome instead',
      tool: 'get_job_status',
      args: { runId },
    });
  }
}

/** `cancel_job` cancels job runs; a workflow run runs until it finishes. */
export class JobRunNotCancellableError extends PublicMcpError {
  constructor(runId: string) {
    super(
      `Run "${runId}" is a workflow run, which cancel_job does not cancel`,
      'JOB_RUN_NOT_CANCELLABLE',
      409,
      undefined,
      {
        say: 'Wait for the workflow run to finish',
        tool: 'get_workflow_status',
        args: { runId },
      },
    );
  }
}

/** `jobs.store.redis` names a backend the job stores cannot open, such as Vercel KV; the server refuses to start. */
export class JobStoreNotSupportedError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'JOB_STORE_NOT_SUPPORTED');
    this.name = 'JobStoreNotSupportedError';
  }
}
