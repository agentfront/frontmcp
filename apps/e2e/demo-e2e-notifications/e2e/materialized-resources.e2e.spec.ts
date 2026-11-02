/**
 * A materialized resource (`@Resource({ from: store.key(...) })`) on a SQLite store: a write from another process
 * reaches the sessions subscribed to it as `notifications/resources/updated`, and its read serves the new value.
 */
import * as os from 'node:os';

import { expect, test, type McpTestClient } from '@frontmcp/testing';
import { pathJoin, rm } from '@frontmcp/utils';

import { writeBoardFromAnotherProcess } from './helpers/board-writer';

const boardDb = pathJoin(os.tmpdir(), `frontmcp-materialized-${process.pid}.sqlite`);
const BOARD_URI = 'board://status';
const UPDATED = 'notifications/resources/updated';

function updatesOf(mcp: McpTestClient): number {
  return mcp.notifications
    .collect()
    .received.filter(({ method, params }) => method === UPDATED && (params as { uri?: string })?.uri === BOARD_URI)
    .length;
}

/** Wait, with a generous deadline for a loaded machine, until `mcp` was told of more board updates than `seen`. */
async function nextUpdate(mcp: McpTestClient, seen: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (updatesOf(mcp) <= seen) {
    if (Date.now() > deadline) throw new Error(`no ${UPDATED} for ${BOARD_URI} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function revisionOf(read: { raw: { _meta?: Record<string, unknown> } }): number {
  return (read.raw._meta?.['frontmcp/materialized'] as { revision: number }).revision;
}

test.describe('Materialized resources E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-notifications/src/materialized.main.ts',
    project: 'demo-e2e-notifications',
    publicMode: true,
    env: { BOARD_DB: boardDb },
  });

  test.afterAll(async () => {
    for (const suffix of ['', '-wal', '-shm']) await rm(`${boardDb}${suffix}`, { force: true });
  });

  test('a write from another process reaches a subscribed session, and the read serves it', async ({ mcp }) => {
    await mcp.resources.subscribe(BOARD_URI);
    const before = revisionOf(await mcp.resources.read(BOARD_URI));
    const seen = updatesOf(mcp);

    const written = await writeBoardFromAnotherProcess(boardDb, { open: 3, note: 'from another process' });
    await nextUpdate(mcp, seen);

    const after = await mcp.resources.read(BOARD_URI);
    expect(after).toBeSuccessful();
    expect(after.json()).toEqual({ open: 3, note: 'from another process' });
    expect(after.mimeType()).toBe('application/json');
    expect(written.revision).toBe(before + 1);
    expect(revisionOf(after)).toBe(written.revision);
  });

  test('only the sessions subscribed to the resource are told', async ({ mcp, server }) => {
    const bystander = await server.createClient();
    await mcp.resources.subscribe(BOARD_URI);
    const seen = updatesOf(mcp);

    await writeBoardFromAnotherProcess(boardDb, { open: 4, note: 'again' });
    await nextUpdate(mcp, seen);

    expect(updatesOf(bystander)).toBe(0);
  });

  test('an unsubscribed session is told no more', async ({ mcp, server }) => {
    const watcher = await server.createClient();
    await watcher.resources.subscribe(BOARD_URI);
    await mcp.resources.subscribe(BOARD_URI);
    await mcp.resources.unsubscribe(BOARD_URI);
    const seen = updatesOf(watcher);

    await writeBoardFromAnotherProcess(boardDb, { open: 5, note: 'once more' });
    await nextUpdate(watcher, seen);

    expect(updatesOf(mcp)).toBe(0);
  });
});
