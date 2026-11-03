/**
 * E2E: `jobs.store: false` keeps job runs in the server's memory although it has a top-level SQLite store, which its
 * sessions still use.
 */
import * as os from 'node:os';

import { expect, test } from '@frontmcp/testing';
import { pathJoin } from '@frontmcp/utils';

import { sqliteKeys } from './helpers/sqlite-keys';

const sqlitePath = pathJoin(os.tmpdir(), `frontmcp-e2e-memory-jobs-${process.pid}.sqlite`);

test.describe('Jobs with jobs.store: false and a top-level SQLite store', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-jobs/src/main.memory-store.ts',
    project: 'demo-e2e-jobs',
    publicMode: true,
    env: { JOBS_SQLITE_PATH: sqlitePath },
  });

  test('runs a job and keeps its run in memory, out of the SQLite file the sessions use', async ({ mcp }) => {
    const result = await mcp.tools.call('execute_job', { name: 'answer-now', input: {} });
    expect(result).toBeSuccessful();
    const { runId } = result.json<{ runId: string }>();
    expect((await mcp.tools.call('get_job_status', { runId })).json()).toEqual(
      expect.objectContaining({ runId, state: 'completed' }),
    );

    const keys = await sqliteKeys(sqlitePath);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => key.startsWith('mcp:jobs:'))).toEqual([]);
  });
});
