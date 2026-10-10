/**
 * E2E: every job attempt runs the hookable `jobs:execute-job` flow (#700).
 *
 * The `JobHooks` app installs a plugin whose `Did('updateRunState')` hook records each attempt it sees.
 * Before, jobs ran outside any flow, so such a hook saw no job run at all; the closest stand-in, a hook
 * on the `execute_job` tool's `tools:call-tool` flow, saw one call and none of its retries, background
 * attempts or workflow steps.
 */
import { expect, test } from '@frontmcp/testing';

interface AuditEntry {
  job: string;
  attempt: number;
  outcome: 'ok' | 'error';
  runId?: string;
  workflow?: string;
  stepId?: string;
}

test.describe('Job hooks E2E (#700)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-jobs/src/main.hooks.ts',
    project: 'demo-e2e-jobs',
    publicMode: true,
  });

  test('a plugin hook observes an inline run', async ({ mcp }) => {
    await mcp.tools.call('clear-job-audit', {});

    const result = await mcp.tools.call('execute_job', { name: 'audited-greet', input: { name: 'Ada' } });

    expect(result).toBeSuccessful();
    const { runId } = result.json<{ runId: string }>();
    const audit = await mcp.tools.call('get-job-audit', {});
    expect(audit.json<{ entries: AuditEntry[] }>().entries).toEqual([
      { job: 'audited-greet', attempt: 1, outcome: 'ok', runId },
    ]);
  });

  test('a plugin hook observes every attempt of a retried run', async ({ mcp }) => {
    await mcp.tools.call('clear-job-audit', {});

    const result = await mcp.tools.call('execute_job', { name: 'flaky-count', input: {} });

    expect(result).toBeSuccessful();
    const run = result.json<{ runId: string; state: string; result: unknown }>();
    expect(run).toEqual(expect.objectContaining({ state: 'completed', result: { attempt: 3 } }));
    const audit = await mcp.tools.call('get-job-audit', {});
    expect(audit.json<{ entries: AuditEntry[] }>().entries).toEqual([
      { job: 'flaky-count', attempt: 1, outcome: 'error', runId: run.runId },
      { job: 'flaky-count', attempt: 2, outcome: 'error', runId: run.runId },
      { job: 'flaky-count', attempt: 3, outcome: 'ok', runId: run.runId },
    ]);
  });

  test('a plugin hook observes each workflow step attempt', async ({ mcp }) => {
    await mcp.tools.call('clear-job-audit', {});

    const result = await mcp.tools.call('execute_workflow', { name: 'audited-flow' });

    expect(result).toBeSuccessful();
    expect(result.json<{ state: string }>().state).toBe('completed');
    const audit = await mcp.tools.call('get-job-audit', {});
    expect(audit.json<{ entries: AuditEntry[] }>().entries).toEqual([
      { job: 'audited-greet', attempt: 1, outcome: 'ok', workflow: 'audited-flow', stepId: 'greet' },
      { job: 'flaky-count', attempt: 1, outcome: 'error', workflow: 'audited-flow', stepId: 'count' },
      { job: 'flaky-count', attempt: 2, outcome: 'error', workflow: 'audited-flow', stepId: 'count' },
      { job: 'flaky-count', attempt: 3, outcome: 'ok', workflow: 'audited-flow', stepId: 'count' },
    ]);
  });

  test('a plugin hook observes a background run', async ({ mcp }) => {
    await mcp.tools.call('clear-job-audit', {});

    const started = await mcp.tools.call('execute_job', {
      name: 'audited-greet',
      input: { name: 'Background' },
      background: true,
    });

    expect(started).toBeSuccessful();
    const { runId } = started.json<{ runId: string }>();
    let entries: AuditEntry[] = [];
    for (let poll = 0; poll < 100 && entries.length === 0; poll++) {
      const audit = await mcp.tools.call('get-job-audit', {});
      entries = audit.json<{ entries: AuditEntry[] }>().entries;
      if (entries.length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(entries).toEqual([{ job: 'audited-greet', attempt: 1, outcome: 'ok', runId }]);
  });
});
