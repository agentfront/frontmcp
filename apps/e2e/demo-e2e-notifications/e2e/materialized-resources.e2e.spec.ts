/**
 * A materialized resource (`@Resource({ from: store.key(...) })`) on a SQLite store: a write from another process
 * reaches the sessions subscribed to it as `notifications/resources/updated`, and its read serves the new value. A
 * template (`@ResourceTemplate({ from: store.family(...) })`) does the same per URI, and a producer-backed key runs
 * its producer on a read, and on a dirty mark only while a session subscribes.
 */
import * as os from 'node:os';

import { expect, test, type McpTestClient } from '@frontmcp/testing';
import { pathJoin, rm } from '@frontmcp/utils';

import { writeBoardFromAnotherProcess, writeColumnFromAnotherProcess } from './helpers/board-writer';

const boardDb = pathJoin(os.tmpdir(), `frontmcp-materialized-${process.pid}.sqlite`);
const BOARD_URI = 'board://status';
const TODO_URI = 'board://columns/todo';
const SUMMARY_URI = 'board://summary';
const UPDATED = 'notifications/resources/updated';

function updatesOf(mcp: McpTestClient, uri = BOARD_URI): number {
  return mcp.notifications
    .collect()
    .received.filter(({ method, params }) => method === UPDATED && (params as { uri?: string })?.uri === uri).length;
}

/** Wait, with a generous deadline for a loaded machine, until `mcp` was told of more updates of `uri` than `seen`. */
async function nextUpdate(mcp: McpTestClient, seen: number, uri = BOARD_URI, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (updatesOf(mcp, uri) <= seen) {
    if (Date.now() > deadline) throw new Error(`no ${UPDATED} for ${uri} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function summaryRuns(mcp: McpTestClient): Promise<number> {
  return ((await mcp.tools.call('summary_runs', {})).json() as { runs: number }).runs;
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

  test("a template URI a session subscribed to is told of a write to its parameters' key, and not of another", async ({
    mcp,
  }) => {
    await mcp.resources.subscribe(TODO_URI);
    const seen = updatesOf(mcp, TODO_URI);

    await writeColumnFromAnotherProcess(boardDb, 'done', ['shipped']);
    const written = await writeColumnFromAnotherProcess(boardDb, 'todo', ['write docs']);
    await nextUpdate(mcp, seen, TODO_URI);

    const todo = await mcp.resources.read(TODO_URI);
    expect(todo.json()).toEqual(['write docs']);
    expect(revisionOf(todo)).toBe(written.revision);
    expect((await mcp.resources.read('board://columns/done')).json()).toEqual(['shipped']);
    expect(updatesOf(mcp, 'board://columns/done')).toBe(0);
  });

  test('a producer-backed resource runs on a read, and on a dirty mark only while a session subscribes', async ({
    mcp,
  }) => {
    const runsBefore = await summaryRuns(mcp);
    await mcp.tools.call('pin_note', { note: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await summaryRuns(mcp)).toBe(runsBefore);

    const read = await mcp.resources.read(SUMMARY_URI);
    expect(await summaryRuns(mcp)).toBe(runsBefore + 1);
    const pinned = (read.json() as { pinned: number }).pinned;

    await mcp.resources.subscribe(SUMMARY_URI);
    const seen = updatesOf(mcp, SUMMARY_URI);
    await mcp.tools.call('pin_note', { note: 'second' });
    await nextUpdate(mcp, seen, SUMMARY_URI);
    const changed = await mcp.resources.read(SUMMARY_URI);
    expect(changed.json()).toEqual({ pinned: pinned + 1, latest: 'second' });
    expect(revisionOf(changed)).toBe(revisionOf(read) + 1);

    const runsAfterChange = await summaryRuns(mcp);
    await mcp.tools.call('refresh_summary', {});
    const deadline = Date.now() + 30_000;
    while ((await summaryRuns(mcp)) === runsAfterChange && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await summaryRuns(mcp)).toBe(runsAfterChange + 1);
    expect(updatesOf(mcp, SUMMARY_URI)).toBe(seen + 1);
    expect(revisionOf(await mcp.resources.read(SUMMARY_URI))).toBe(revisionOf(changed));
  });
});
