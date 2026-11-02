/**
 * E2E: Finally hooks run after a stage whatever its outcome, and never change what the client gets.
 *
 * The finally-recorder plugin records how the `execute` and `finalize` stages of a call ended. Before its
 * recorders run, two other Finally hooks of `finalize` try to answer in place of the call and to fail it: both
 * are ignored. `refused-answer` answers with a value its output schema refuses (a `finalize` failure, which used
 * to skip every hook after the stage), and `failing-execute` fails in `execute`.
 */
import { expect, test, type ServerFixture } from '@frontmcp/testing';

interface FinallyLog {
  entries: Array<{ stage: string; outcome: string }>;
}

/** The server's logs once they contain `text`, or as they are after `timeoutMs`: its output reaches us after the reply. */
async function logsOnceTheyContain(server: ServerFixture, text: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (!server.getLogs().join('\n').includes(text) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return server.getLogs().join('\n');
}

test.describe('Finally hooks E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-hooks/src/main.ts',
    project: 'demo-e2e-hooks',
    publicMode: true,
  });

  test('see an answer the output schema refuses, and the client still gets INVALID_OUTPUT', async ({ mcp }) => {
    await mcp.tools.call('clear-audit-log', {});

    const result = await mcp.tools.call('refused-answer', {});

    expect(result).toBeError();
    expect(result.raw._meta?.['code']).toBe('INVALID_OUTPUT');
    expect(result).not.toHaveTextContent('replaced by a Finally hook');
    const log = await mcp.tools.call('get-finally-log', { toolName: 'refused-answer' });
    expect(log.json<FinallyLog>().entries).toEqual([
      { stage: 'execute', outcome: 'ok' },
      { stage: 'finalize', outcome: 'InvalidOutputError' },
    ]);
  });

  test('see an execute that failed, and the client still gets its error', async ({ mcp }) => {
    await mcp.tools.call('clear-audit-log', {});

    const result = await mcp.tools.call('failing-execute', {});

    expect(result).toBeError();
    expect(result.text()).toBe('The ledger is unreachable');
    const log = await mcp.tools.call('get-finally-log', { toolName: 'failing-execute' });
    expect(log.json<FinallyLog>().entries).toEqual([
      { stage: 'execute', outcome: 'PublicMcpError' },
      { stage: 'finalize', outcome: 'PublicMcpError' },
    ]);
  });

  test('see a call that succeeded, and its answer is left as it was', async ({ mcp }) => {
    await mcp.tools.call('clear-audit-log', {});

    const result = await mcp.tools.call('audited-tool', { message: 'finally' });

    expect(result).toBeSuccessful();
    expect(result.json<{ message: string }>().message).toBe('Processed: finally');
    const log = await mcp.tools.call('get-finally-log', { toolName: 'audited-tool' });
    expect(log.json<FinallyLog>().entries).toEqual([
      { stage: 'execute', outcome: 'ok' },
      { stage: 'finalize', outcome: 'ok' },
    ]);
  });

  test('log what an ignored Finally hook threw', async ({ mcp, server }) => {
    server.clearLogs();

    await mcp.tools.call('audited-tool', { message: 'logged' });

    expect(await logsOnceTheyContain(server, 'the recorder store is down')).toContain('the recorder store is down');
  });
});
