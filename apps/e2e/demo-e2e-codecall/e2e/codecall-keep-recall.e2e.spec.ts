/**
 * keep and recall over HTTP: a value one script keeps, a later script of the same session recalls; another session,
 * or the same one after the TTL, recalls nothing; a 5 MB string kept in one script reaches a tool of the next without
 * entering its sandbox, whose memory limit is 1 MiB.
 */
import { expect, test } from '@frontmcp/testing';

interface ExecuteResult {
  status: string;
  result?: unknown;
  kept?: string[];
  error?: { message: string };
}

const FIVE_MB = 5 * 1024 * 1024;
const KEEP_OVERDUE =
  "const { users } = await callTool('users-list', {});\nawait keep('overdue', users);\nreturn users.length;";
const RECALL_OVERDUE =
  "const overdue = await recall('overdue');\nreturn overdue === undefined ? 'not found' : overdue.map((u) => u.id);";

test.describe('CodeCall keep and recall E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-codecall/src/main-keep.ts',
    project: 'demo-e2e-codecall',
    publicMode: true,
  });

  test('recalls in a later script what an earlier one kept, and nothing in another session', async ({
    mcp,
    server,
  }) => {
    const kept = (await mcp.tools.call('codecall:execute', { script: KEEP_OVERDUE })).json<ExecuteResult>();
    expect(kept).toMatchObject({ status: 'ok', kept: ['overdue'] });
    expect(JSON.stringify(kept)).not.toContain('@');

    const recalled = (await mcp.tools.call('codecall:execute', { script: RECALL_OVERDUE })).json<ExecuteResult>();
    expect(recalled.status).toBe('ok');
    expect(recalled.result).toEqual(expect.arrayContaining(['user-1']));

    const other = await server.createClient();
    const elsewhere = (await other.tools.call('codecall:execute', { script: RECALL_OVERDUE })).json<ExecuteResult>();
    expect(elsewhere).toMatchObject({ status: 'ok', result: 'not found' });
  });

  test('recalls nothing after the TTL', async ({ mcp }) => {
    await mcp.tools.call('codecall:execute', { script: KEEP_OVERDUE });
    await new Promise((resolve) => setTimeout(resolve, 5500));

    const recalled = (await mcp.tools.call('codecall:execute', { script: RECALL_OVERDUE })).json<ExecuteResult>();
    expect(recalled).toMatchObject({ status: 'ok', result: 'not found' });
  });

  test('passes a 5 MB string kept in one script to a tool in the next, outside the sandbox', async ({ mcp }) => {
    const kept = (
      await mcp.tools.call('codecall:execute', {
        script: `const doc = await callTool('docs-read', { bytes: ${FIVE_MB} });\nawait keep('doc', doc);\nreturn 'kept';`,
      })
    ).json<ExecuteResult>();
    expect(kept).toMatchObject({ status: 'ok', kept: ['doc'] });

    const measured = (
      await mcp.tools.call('codecall:execute', {
        script:
          "const doc = await recall('doc');\nconst measured = await callTool('docs-measure', { text: doc });\n" +
          'return { held: doc.length, measured };',
      })
    ).json<ExecuteResult>();
    expect(measured).toMatchObject({ status: 'ok', result: { measured: { length: FIVE_MB, onlyD: true } } });
    expect((measured.result as { held: number }).held).toBeLessThan(100);
  });
});
