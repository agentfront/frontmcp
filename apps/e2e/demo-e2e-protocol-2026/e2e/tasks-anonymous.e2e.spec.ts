/**
 * Tasks require an identified caller under protocol 2026-07-28.
 *
 * The revision removed protocol sessions, so a durable task can only be scoped
 * by the authenticated principal. A public server has none — pooling every
 * anonymous caller into one task namespace would let them read each other's
 * results, so the server refuses instead.
 *
 * Lives in its own file because the test fixture starts ONE server per spec
 * file: a second `test.use()` in the tasks suite would silently replace the
 * authenticated fixture.
 */
import { expect, test } from '@frontmcp/testing';

import { mcp2026Fetch } from './helpers/mcp-2026-client';

const TASKS_EXT = { extensions: { 'io.modelcontextprotocol/tasks': {} } };

test.describe('protocol 2026-07-28 — tasks require an identified caller', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-2026/src/main.ts',
    project: 'demo-e2e-protocol-2026',
    publicMode: true,
  });

  test('refuses tasks/get for an anonymous caller', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, {
      method: 'tasks/get',
      id: 1,
      params: { taskId: 'anything' },
      clientCapabilities: TASKS_EXT,
    });

    expect(res.json().error.message).toContain('authenticated caller');
  });

  test('refuses tasks/update for an anonymous caller', async ({ server }) => {
    const res = await mcp2026Fetch(server.info.baseUrl, {
      method: 'tasks/update',
      id: 2,
      params: { taskId: 'anything', inputResponses: {} },
      clientCapabilities: TASKS_EXT,
    });

    expect(res.json().error.message).toContain('authenticated caller');
  });
});
