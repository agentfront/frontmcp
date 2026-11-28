/**
 * Pause and resume over HTTP: a script whose third call needs a person's approval pauses before it; once a person
 * approves, codecall:resume runs the third call live without calling the first two again, and a parallel() whose third
 * call needs approval runs only that call; a run past its wait is not found, and so is a run another session tries to
 * resume.
 */
import { expect, test } from '@frontmcp/testing';

interface RunAnswer {
  status: string;
  runId?: string;
  result?: unknown;
  approval?: { id: string; toolName?: string };
  paused?: { call: { position: number; tool: string }; expiresAt: string };
}

interface ActivitiesAnswer {
  activities: Array<{ description: string }>;
}

/** Two calls with effects, then one that needs approval at the call, since its argument is computed. */
function scriptOffboarding(userNumber: number, marker: string): string {
  const userId = `user-${userNumber}`;
  return (
    `await callTool('activities-log', { userId: '${userId}', type: 'note', description: '${marker} first' });\n` +
    `await callTool('activities-log', { userId: '${userId}', type: 'note', description: '${marker} second' });\n` +
    `const done = await callTool('users-offboard', { id: 'user-' + ${userNumber} });\n` +
    'return done.offboarded;'
  );
}

test.describe('CodeCall pause and resume E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-codecall/src/main-pause.ts',
    project: 'demo-e2e-codecall',
    publicMode: true,
  });

  test('pauses before the third call, which needs approval, and resumes it without running the first two again', async ({
    mcp,
  }) => {
    const logged = async () =>
      (await mcp.tools.call('codecall:invoke', { tool: 'activities-list', input: { userId: 'user-3' } }))
        .json<ActivitiesAnswer>()
        .activities.filter(({ description }) => description.startsWith('pause-e2e'));

    const paused = (
      await mcp.tools.call('codecall:execute', { script: scriptOffboarding(3, 'pause-e2e') })
    ).json<RunAnswer>();

    expect(paused).toMatchObject({
      status: 'needs_approval',
      runId: expect.any(String),
      approval: { toolName: 'users-offboard' },
      paused: { call: { position: 3, tool: 'users-offboard' } },
    });
    expect(await logged()).toHaveLength(2);
    expect((await mcp.tools.call('codecall:status', { runId: paused.runId })).json<RunAnswer>().status).toBe('paused');

    await mcp.tools.call('approvals-grant', { id: paused.approval?.id });
    const resumed = await mcp.tools.call('codecall:resume', { runId: paused.runId });

    expect(resumed.json<RunAnswer>()).toMatchObject({ status: 'ok', result: true, runId: paused.runId });
    expect(await logged()).toHaveLength(2);
    const offboarded = await mcp.tools.call('codecall:invoke', { tool: 'users-get', input: { id: 'user-3' } });
    expect(offboarded.json<{ user: unknown }>().user).toBeNull();
    expect(await mcp.tools.call('codecall:resume', { runId: paused.runId })).toBeError();
  });

  test('pauses a parallel() at its third call, which needs approval, and resumes it without running the other four again', async ({
    mcp,
  }) => {
    const logged = async () =>
      (await mcp.tools.call('codecall:invoke', { tool: 'activities-list', input: { userId: 'user-2' } }))
        .json<ActivitiesAnswer>()
        .activities.filter(({ description }) => description.startsWith('parallel-e2e'));
    const script =
      'return await parallel([1, 2, 3, 4, 5], (step) =>\n' +
      '  step === 3\n' +
      "    ? callTool('users-offboard', { id: 'user-' + 2 })\n" +
      "    : callTool('activities-log', { userId: 'user-2', type: 'note', description: 'parallel-e2e ' + step }),\n" +
      ');';

    const paused = (await mcp.tools.call('codecall:execute', { script })).json<RunAnswer>();

    expect(paused).toMatchObject({
      status: 'needs_approval',
      approval: { toolName: 'users-offboard' },
      paused: { call: { position: 3, tool: 'users-offboard' } },
    });
    expect((await logged()).map(({ description }) => description).sort()).toEqual([
      'parallel-e2e 1',
      'parallel-e2e 2',
      'parallel-e2e 4',
      'parallel-e2e 5',
    ]);

    await mcp.tools.call('approvals-grant', { id: paused.approval?.id });
    const resumed = (await mcp.tools.call('codecall:resume', { runId: paused.runId })).json<RunAnswer>();

    expect(resumed).toMatchObject({ status: 'ok', runId: paused.runId });
    expect((resumed.result as unknown[])[2]).toEqual({ offboarded: true });
    expect(await logged()).toHaveLength(4);
    const offboarded = await mcp.tools.call('codecall:invoke', { tool: 'users-get', input: { id: 'user-2' } });
    expect(offboarded.json<{ user: unknown }>().user).toBeNull();
  });

  test('answers that a run past its wait is not found', async ({ mcp }) => {
    const paused = (
      await mcp.tools.call('codecall:execute', { script: scriptOffboarding(4, 'expiry-e2e') })
    ).json<RunAnswer>();
    expect(paused.paused).toBeDefined();
    await mcp.tools.call('approvals-grant', { id: paused.approval?.id });

    await new Promise((resolve) => setTimeout(resolve, 3500));
    const late = await mcp.tools.call('codecall:resume', { runId: paused.runId });

    expect(late).toBeError();
    expect(late.text()).toContain('was not found');
  });

  test('answers that a run another session paused is not found', async ({ mcp, server }) => {
    const paused = (
      await mcp.tools.call('codecall:execute', { script: scriptOffboarding(5, 'owner-e2e') })
    ).json<RunAnswer>();
    const stranger = await server.createClient();

    const taken = await stranger.tools.call('codecall:resume', { runId: paused.runId });

    expect(taken).toBeError();
    expect(taken.text()).toContain('was not found');
    await stranger.disconnect();
  });
});
