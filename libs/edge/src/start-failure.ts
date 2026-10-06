import { describeConfigIssues } from '@frontmcp/sdk';

/** Log why a deferred server build failed, naming the invalid fields of a config that failed validation. */
export function logStartFailure(summary: string, error: unknown): void {
  const configIssues = describeConfigIssues(error);
  console.error(configIssues ? `${summary} Invalid configuration: ${configIssues}` : summary, error);
}
