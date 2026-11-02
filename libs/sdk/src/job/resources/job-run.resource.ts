import { type ReadResourceResult } from '@frontmcp/protocol';

import { ResourceTemplate } from '../../common';
import { ResourceContext } from '../../common/interfaces';
import { ResourceNotFoundError } from '../../errors';
import { jobExecutionManagerOf, mayAccessRun } from '../job-run-access';

type Params = { runId: string };

/**
 * `job://runs/{runId}`: a job or workflow run as JSON, read from the job store. Subscribers get
 * `notifications/resources/updated` each time this process writes the run. A run the caller may not
 * read reads as not found, like an unknown one.
 */
@ResourceTemplate({
  name: 'job-run',
  uriTemplate: 'job://runs/{runId}',
  description: 'A job or workflow run: its state, progress, result or error, revision and last update',
  mimeType: 'application/json',
})
export class JobRunResource extends ResourceContext<Params> {
  async execute(uri: string, { runId }: Params): Promise<ReadResourceResult> {
    const record = await jobExecutionManagerOf(this.scope)?.getStatus(runId);
    if (!record || !(await mayAccessRun(this.scope, record, 'read', this.getAuthInfo()))) {
      throw new ResourceNotFoundError(uri);
    }
    const run = {
      runId: record.runId,
      jobName: record.jobName,
      state: record.state,
      attempt: record.attempt,
      maxAttempts: record.maxAttempts,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      updatedAt: record.updatedAt,
      revision: record.revision,
      progress: record.progress,
      result: record.result,
      error: record.error && { name: record.error.name, message: record.error.message },
      logs: record.logs,
    };
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(run) }] };
  }
}
