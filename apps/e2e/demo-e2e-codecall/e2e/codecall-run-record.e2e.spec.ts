/** E2E tests for CodeCall run records and the default trace a failed run returns. */
import { expect, test } from '@frontmcp/testing';

interface JournalEntry {
  position: number;
  tool: string;
  argumentsHash: string;
  outcome: string;
  phase?: string;
  durationMs: number;
  resultBytes?: number;
}

interface RunRecord {
  runId: string;
  scriptHash: string;
  status: string;
  reviewDecision: string | null;
  journal: JournalEntry[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.describe('CodeCall run records E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-codecall/src/main.ts',
    project: 'demo-e2e-codecall',
    publicMode: true,
  });

  test('keeps one record with a journal entry per tool call, read by its owner only', async ({ mcp, server }) => {
    const executed = await mcp.tools.call('codecall:execute', {
      script: `
        const users = await callTool('users-list', {});
        const first = await callTool('users-get', { id: 'user-1' });
        const stats = await callTool('activities-stats', {});
        return { count: users.count, name: first.user.name, total: stats.total };
      `,
    });
    expect(executed).toBeSuccessful();
    const { status, runId } = executed.json<{ status: string; runId: string }>();
    expect(status).toBe('ok');
    expect(runId).toMatch(UUID);

    const read = await mcp.tools.call('runs-read', { runId });
    const { record } = read.json<{ record: RunRecord }>();
    expect(record).toMatchObject({ runId, status: 'ok', reviewDecision: null });
    expect(record.journal.map(({ position, tool, outcome }) => ({ position, tool, outcome }))).toEqual([
      { position: 1, tool: 'users-list', outcome: 'success' },
      { position: 2, tool: 'users-get', outcome: 'success' },
      { position: 3, tool: 'activities-stats', outcome: 'success' },
    ]);
    for (const entry of record.journal) {
      expect(entry.argumentsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.resultBytes).toBeGreaterThan(0);
    }

    const other = await server.createClient();
    const otherRead = await other.tools.call('runs-read', { runId });
    expect(otherRead.json<{ record: RunRecord | null }>().record).toBeNull();
  });

  test('lists the calls a failed script made before it failed, by default, without values', async ({ mcp }) => {
    const executed = await mcp.tools.call('codecall:execute', {
      script: `
        const users = await callTool('users-list', {});
        return await callTool('users-get', { id: 42 });
      `,
    });
    const { status, trace } = executed.json<{ status: string; trace?: string[] }>();

    expect(status).toBe('tool_error');
    expect(trace).toEqual([
      expect.stringMatching(/^1\. users-list: success, \d+ ms, \d+ bytes$/),
      expect.stringMatching(/^2\. users-get: failure \(input\), \d+ ms$/),
    ]);
    expect(JSON.stringify(trace)).not.toContain('John Doe');
  });

  test('returns no trace for a script that returned, by default', async ({ mcp }) => {
    const executed = await mcp.tools.call('codecall:execute', { script: "return await callTool('users-list', {});" });

    expect(executed.json<{ status: string }>().status).toBe('ok');
    expect(executed.json<Record<string, unknown>>()).not.toHaveProperty('trace');
  });
});
