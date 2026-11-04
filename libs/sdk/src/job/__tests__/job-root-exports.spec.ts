import 'reflect-metadata';

import { type ScopeEntry } from '../../common';
import * as sdk from '../../index';
import { JobAdmission } from '../job-admission';
import { jobRunUri, mayAccessRun } from '../job-run-access';
import { type JobRunRecord } from '../store/job-state.interface';

/** A custom host builds its own `JobExecutionManager`, and needs what its options and the job tools use (#1051). */
describe('the job exports of @frontmcp/sdk', () => {
  it('exports JobAdmission, which JobExecutionManagerOptions.admission takes', () => {
    expect(sdk.JobAdmission).toBe(JobAdmission);
    expect(sdk.JobExecutionManager).toEqual(expect.any(Function));
  });

  it('exports jobRunUri and mayAccessRun', () => {
    expect(sdk.jobRunUri).toBe(jobRunUri);
    expect(sdk.mayAccessRun).toBe(mayAccessRun);
    expect(sdk.jobRunUri('run-1')).toBe('job://runs/run-1');
  });

  it('lets mayAccessRun allow the session that started a run', async () => {
    const scope = { authoritiesContextBuilder: undefined, jobs: undefined } as unknown as ScopeEntry;
    const run = { runId: 'run-1', jobName: 'export', sessionId: 'session-1' } as JobRunRecord;

    await expect(sdk.mayAccessRun(scope, run, 'read', { sessionId: 'session-1' })).resolves.toBe(true);
    await expect(sdk.mayAccessRun(scope, run, 'read', { sessionId: 'session-2' })).resolves.toBe(false);
  });
});
