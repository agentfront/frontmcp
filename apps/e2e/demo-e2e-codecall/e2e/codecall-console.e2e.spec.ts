/**
 * `vm.allowConsole`: a script's `console` calls reach the server's logger only when the server sets
 * `vm.allowConsole: true`; the documented setup, with the default preset, still refuses them before the script runs.
 */
import { expect, test } from '@frontmcp/testing';

interface ExecuteResult {
  status: string;
  result?: unknown;
  error?: unknown;
}

test.describe('CodeCall with vm.allowConsole: true', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-codecall/src/main-console.ts',
    project: 'demo-e2e-codecall',
    publicMode: true,
  });

  test("sends the script's console lines to the server's logger", async ({ mcp, server }) => {
    const result = await mcp.tools.call('codecall:execute', {
      script: "console.log('users', 3);\nconsole.warn('careful');\nreturn 'done';",
    });

    expect(result).toBeSuccessful();
    expect(result.json<ExecuteResult>()).toMatchObject({ status: 'ok', result: 'done' });
    const lines = await (await fetch(`${server.info.baseUrl}/test/script-console`)).json();
    expect(lines).toEqual([
      { level: 'info', message: 'users 3' },
      { level: 'warn', message: 'careful' },
    ]);
  });
});
