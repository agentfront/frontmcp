import 'reflect-metadata';

import { type ScopeEntry } from '../../common';
import { mayAccessRun } from '../job-run-access';
import { type JobRunRecord, type WorkflowRunRecord } from '../store/job-state.interface';

/** A scope whose job and workflow named `export` let anyone read and cancel their runs. */
function openScope(id: string): ScopeEntry {
  const entry = { metadata: { permissions: [{ action: 'read' }, { action: 'delete' }] } };
  return {
    id,
    authoritiesContextBuilder: undefined,
    jobs: { findByName: () => entry },
    workflows: { findByName: () => entry },
  } as unknown as ScopeEntry;
}

const caller = { user: { iss: 'https://a.example', sub: 'user-2' } };

describe('a run another scope started', () => {
  it('is not readable or cancellable through a scope whose same-named job allows it', async () => {
    const run = { runId: 'run-1', jobName: 'export', ownerSub: 'user-1', scopeId: 'app-a' } as JobRunRecord;

    await expect(mayAccessRun(openScope('app-b'), run, 'read', caller)).resolves.toBe(false);
    await expect(mayAccessRun(openScope('app-b'), run, 'delete', caller)).resolves.toBe(false);
  });

  it('is not readable through another scope for a workflow run either', async () => {
    const run = {
      runId: 'run-1',
      jobName: 'export',
      workflowName: 'export',
      ownerSub: 'user-1',
      scopeId: 'app-a',
    } as WorkflowRunRecord;

    await expect(mayAccessRun(openScope('app-b'), run, 'read', caller)).resolves.toBe(false);
  });

  it('stays readable through its own scope under the rules there', async () => {
    const run = { runId: 'run-1', jobName: 'export', ownerSub: 'user-1', scopeId: 'app-a' } as JobRunRecord;

    await expect(mayAccessRun(openScope('app-a'), run, 'read', caller)).resolves.toBe(true);
  });

  it('is judged as before when the run names no scope', async () => {
    const run = { runId: 'run-1', jobName: 'export', ownerSub: 'user-1' } as JobRunRecord;

    await expect(mayAccessRun(openScope('app-b'), run, 'read', caller)).resolves.toBe(true);
  });
});
