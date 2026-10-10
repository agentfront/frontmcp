/**
 * E2E: a tool class hooks the stages before its instance exists with `static` methods (#701).
 *
 * `static-guarded-echo` declares a static `Did('parseInput')` that upper-cases the message and a static
 * `Will('checkToolAuthorization')` that refuses the "blocked" user. `plain-echo` takes the same input and
 * has no hooks, so neither hook may touch it.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Static entry-class hooks E2E (#701)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-hooks/src/main.ts',
    project: 'demo-e2e-hooks',
    publicMode: true,
  });

  test('a static parseInput hook rewrites the input of its own tool', async ({ mcp }) => {
    const result = await mcp.tools.call('static-guarded-echo', { message: 'hello', user: 'ada' });

    expect(result).toBeSuccessful();
    expect(result.json<{ echoed: string }>()).toEqual({ echoed: 'HELLO' });
  });

  test('a static checkToolAuthorization hook denies a caller before the instance is built', async ({ mcp }) => {
    const result = await mcp.tools.call('static-guarded-echo', { message: 'hello', user: 'blocked' });

    expect(result).toBeError();
    expect(result).toHaveTextContent('refuses the "blocked" user');
  });

  test('the static hooks leave another tool alone', async ({ mcp }) => {
    const result = await mcp.tools.call('plain-echo', { message: 'hello', user: 'blocked' });

    expect(result).toBeSuccessful();
    expect(result.json<{ echoed: string }>()).toEqual({ echoed: 'hello' });
  });
});
