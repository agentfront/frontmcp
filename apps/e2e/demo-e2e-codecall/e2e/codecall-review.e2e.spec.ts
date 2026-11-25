/**
 * `review` over HTTP: the built-in rules answer before a script runs, a destructive call waits for a person's
 * approval through the Approval plugin, and `codecall:invoke` follows the same rule.
 */
import { expect, test } from '@frontmcp/testing';

interface ReviewedResult {
  status: string;
  runId?: string;
  result?: unknown;
  reason?: string;
  findings?: Array<{ rule: string; message: string; suggestion?: string; location?: { line: number; column: number } }>;
  approval?: { id: string; toolName?: string };
}

const OFFBOARD_USER_2 = "const done = await callTool('users-offboard', { id: 'user-2' });\nreturn done.offboarded;";

test.describe('CodeCall review E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-codecall/src/main-review.ts',
    project: 'demo-e2e-codecall',
    publicMode: true,
  });

  test('asks for changes to a literal argument of the wrong type, and runs nothing', async ({ mcp }) => {
    const executed = await mcp.tools.call('codecall:execute', {
      script: "const user = await callTool('users-get', { id: 42 });\nreturn user;",
    });

    expect(executed.json<ReviewedResult>()).toMatchObject({
      status: 'needs_changes',
      findings: [
        {
          rule: 'input-schema',
          message: 'users-get: "id" must be a string, not a number',
          suggestion: 'id: "42"',
          location: { line: 1, column: 19 },
        },
      ],
    });
  });

  test('waits for approval of a destructive call; the approved script runs, a changed one asks again', async ({
    mcp,
  }) => {
    const asked = (await mcp.tools.call('codecall:execute', { script: OFFBOARD_USER_2 })).json<ReviewedResult>();
    expect(asked).toMatchObject({ status: 'needs_approval', approval: { toolName: 'users-offboard' } });

    const stillThere = await mcp.tools.call('codecall:execute', {
      script: "const user = await callTool('users-get', { id: 'user-2' });\nreturn user.user.id;",
    });
    expect(stillThere.json<ReviewedResult>()).toMatchObject({ status: 'ok', result: 'user-2' });

    await mcp.tools.call('approvals-grant', { id: asked.approval?.id });
    const approved = (await mcp.tools.call('codecall:execute', { script: OFFBOARD_USER_2 })).json<ReviewedResult>();
    expect(approved).toMatchObject({ status: 'ok', result: true });

    const read = await mcp.tools.call('runs-read', { runId: approved.runId });
    expect(read.json<{ record: { reviewDecision: string } }>().record.reviewDecision).toBe('allow');

    const changed = await mcp.tools.call('codecall:execute', {
      script: OFFBOARD_USER_2.replace('user-2', 'user-3'),
    });
    expect(changed.json<ReviewedResult>().status).toBe('needs_approval');
  });

  test('gives codecall:invoke of a destructive tool the same answer', async ({ mcp }) => {
    const invoked = await mcp.tools.call('codecall:invoke', { tool: 'users-offboard', input: { id: 'user-1' } });

    expect(invoked).toBeError();
    expect(invoked.json<ReviewedResult>()).toMatchObject({
      status: 'needs_approval',
      approval: { toolName: 'users-offboard' },
    });
  });
});
