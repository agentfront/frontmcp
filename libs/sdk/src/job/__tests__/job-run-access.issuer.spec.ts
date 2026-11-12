import 'reflect-metadata';

import { type ScopeEntry } from '../../common';
import { mayAccessRun, runOwnerOf } from '../job-run-access';
import { type JobRunRecord } from '../store/job-state.interface';

const scope = { authoritiesContextBuilder: undefined, jobs: undefined } as unknown as ScopeEntry;

/** The auth info of a caller signed in with a token of `iss` naming `sub`. */
function callerOf(iss: string, sub: string): Record<string, unknown> {
  return { user: { iss, sub } };
}

describe('the owner of a job run', () => {
  it('is the subject and the issuer of the caller who started it', () => {
    expect(runOwnerOf(callerOf('https://a.example', 'user-1'), undefined)).toEqual({
      ownerSub: 'user-1',
      ownerIss: 'https://a.example',
    });
  });

  it('is none for an anonymous caller', () => {
    expect(runOwnerOf({}, undefined)).toEqual({});
  });

  it('lets the caller who started a run read and cancel it', async () => {
    const run = { runId: 'run-1', jobName: 'export', ...runOwnerOf(callerOf('https://a.example', 'user-1'), undefined) };

    await expect(mayAccessRun(scope, run as JobRunRecord, 'read', callerOf('https://a.example', 'user-1'))).resolves.toBe(
      true,
    );
    await expect(
      mayAccessRun(scope, run as JobRunRecord, 'delete', callerOf('https://a.example', 'user-1')),
    ).resolves.toBe(true);
  });

  it('does not let a caller of another issuer with the same subject read or cancel the run', async () => {
    const run = { runId: 'run-1', jobName: 'export', ownerSub: 'user-1', ownerIss: 'https://a.example' } as JobRunRecord;

    await expect(mayAccessRun(scope, run, 'read', callerOf('https://b.example', 'user-1'))).resolves.toBe(false);
    await expect(mayAccessRun(scope, run, 'delete', callerOf('https://b.example', 'user-1'))).resolves.toBe(false);
  });

  it('treats a run stored without an issuer as owned by a caller whose token names none', async () => {
    const run = { runId: 'run-1', jobName: 'export', ownerSub: 'user-1' } as JobRunRecord;

    await expect(mayAccessRun(scope, run, 'read', callerOf('https://a.example', 'user-1'))).resolves.toBe(false);
    await expect(mayAccessRun(scope, run, 'read', { user: { sub: 'user-1' } })).resolves.toBe(true);
  });
});
