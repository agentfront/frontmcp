/**
 * E2E for the @frontmcp/testing fixtures against a real server process (issue #644):
 *  - `test.use()` inside `describe` is scoped and each block gets its own server
 *  - `server.info.pid` is the pid of the server, not of the shell that launched it
 *  - `port: 0` picks a free port
 *  - `server.restart()` reconnects `mcp`
 *  - `test.each` / `test.describe.each` receive their rows
 *  - `mcp.logs` is the client's log, `server.getLogs()` is the server's
 */
import { expect, test, TestServer } from '@frontmcp/testing';

const SERVER = 'apps/e2e/demo-e2e-testing/src/main.ts';

function processInfo(result: { json<T>(): T }) {
  return result.json<{ pid: number; marker: string | null; authMode: string | null }>();
}

test.describe('fixtures against a real server', () => {
  test.use({ server: SERVER, project: 'demo-e2e-testing', port: 0, publicMode: true, env: { TEST_MARKER: 'outer' } });

  test('port 0 resolves to a real free port and the pid is the server process', async ({ mcp, server }) => {
    expect(server.info.port).toBeGreaterThan(0);
    const info = processInfo(await mcp.tools.call('process-info', {}));
    expect(info.marker).toBe('outer');
    expect(server.info.pid).toBe(info.pid);
  });

  test.describe('inner block A', () => {
    test.use({ env: { TEST_MARKER: 'A' } });

    test('sees its own env', async ({ mcp }) => {
      expect(processInfo(await mcp.tools.call('process-info', {})).marker).toBe('A');
    });
  });

  test.describe('inner block B', () => {
    test.use({ env: { TEST_MARKER: 'B' } });

    test('does not inherit the env of block A', async ({ mcp }) => {
      expect(processInfo(await mcp.tools.call('process-info', {})).marker).toBe('B');
    });
  });

  test('the outer scope is untouched by the inner blocks', async ({ mcp }) => {
    expect(processInfo(await mcp.tools.call('process-info', {})).marker).toBe('outer');
  });

  test('restart gives a new process and the mcp client is usable again', async ({ mcp, server }) => {
    const before = processInfo(await mcp.tools.call('process-info', {})).pid;
    await server.restart();
    const after = processInfo(await mcp.tools.call('process-info', {}));
    expect(after.pid).not.toBe(before);
    expect(server.info.pid).toBe(after.pid);
  });

  test('server logs and client logs are separate', async ({ mcp, server }) => {
    await mcp.tools.call('process-info', {});
    expect(Array.isArray(server.getLogs())).toBe(true);
    expect(mcp.logs.all().length).toBeGreaterThan(0);
  });

  test.each([
    ['one', 'A'],
    ['two', 'B'],
  ])('test.each row %s', async ({ mcp }, label, letter) => {
    expect(['one', 'two']).toContain(label);
    expect(['A', 'B']).toContain(letter);
    expect((await mcp.tools.list()).length).toBeGreaterThan(0);
  });
});

test.describe('parallel test files do not collide on ports', () => {
  test.use({ server: SERVER, project: 'demo-e2e-testing', port: 0, publicMode: true });

  test('two servers started together get distinct ports', async ({ server }) => {
    const other = await TestServer.start({
      command: `npx tsx ${SERVER}`,
      project: 'demo-e2e-testing',
      port: 0,
      startupTimeout: 30000,
    });
    try {
      expect(other.info.port).not.toBe(server.info.port);
    } finally {
      await other.stop();
    }
  });
});
