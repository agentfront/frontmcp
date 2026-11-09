/**
 * The documented CodeCall setup, with the default preset and no `vm.allowConsole`: a script that uses `console` is
 * refused before it runs, as it was before `vm.allowConsole` worked.
 */
import { expect, test } from '@frontmcp/testing';

interface ExecuteResult {
  status: string;
}

test.describe('CodeCall without vm.allowConsole', () => {
  test.use({ server: 'apps/e2e/demo-e2e-codecall/src/main.ts', project: 'demo-e2e-codecall', publicMode: true });

  test('refuses a script that uses console before it runs', async ({ mcp }) => {
    const result = await mcp.tools.call('codecall:execute', { script: "console.log('hi');\nreturn 1;" });

    expect(result.json<ExecuteResult>().status).toBe('illegal_access');
  });
});
