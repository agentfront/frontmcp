import { PublicMcpError } from './mcp.error';

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
