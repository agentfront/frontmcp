/**
 * A materialized resource on a SQLite store, over 2026-07-28: a write from another process reaches a
 * `subscriptions/listen` stream as `notifications/resources/updated`, and its read is never cached (`ttlMs: 0`).
 */
import * as os from 'node:os';

import { expect, test } from '@frontmcp/testing';
import { pathJoin, rm } from '@frontmcp/utils';

import { writeBoardFromAnotherProcess } from './helpers/board-writer';
import { mcpStatelessFetch, META_SUBSCRIPTION_ID, openMcpStatelessStream } from './helpers/mcp-stateless-client';

const boardDb = pathJoin(os.tmpdir(), `frontmcp-materialized-listen-${process.pid}.sqlite`);
const BOARD_URI = 'board://status';
const ACKNOWLEDGED = 'notifications/subscriptions/acknowledged';
const UPDATED = 'notifications/resources/updated';

test.describe('protocol 2026-07-28 — materialized resources', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main-materialized.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
    env: { BOARD_DB: boardDb },
  });

  test.afterAll(async () => {
    for (const suffix of ['', '-wal', '-shm']) await rm(`${boardDb}${suffix}`, { force: true });
  });

  test('a write from another process reaches a subscriptions/listen stream', async ({ server }) => {
    const stream = await openMcpStatelessStream(server.info.baseUrl, {
      method: 'subscriptions/listen',
      id: 'board-listen',
      params: { notifications: { resourceSubscriptions: [BOARD_URI, 'nothing://here'] } },
    });
    try {
      const ack = await stream.waitFor((message) => message.method === ACKNOWLEDGED);

      const written = await writeBoardFromAnotherProcess(boardDb, { open: 7, note: 'from another process' });
      const updated = await stream.waitFor(
        (message) => message.method === UPDATED && message.params?.uri === BOARD_URI,
        30_000,
      );
      const read = await mcpStatelessFetch(server.info.baseUrl, {
        method: 'resources/read',
        id: 'board-read',
        params: { uri: BOARD_URI },
      });
      const { result } = read.json();

      expect(ack.params.notifications.resourceSubscriptions).toEqual([BOARD_URI]);
      expect(updated.params._meta?.[META_SUBSCRIPTION_ID]).toBe('board-listen');
      expect(JSON.parse(result.contents[0].text)).toEqual({ open: 7, note: 'from another process' });
      expect(result._meta['frontmcp/materialized'].revision).toBe(written.revision);
    } finally {
      stream.close();
    }
  });

  test('the read of a materialized resource is never cached', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'resources/read',
      id: 'board-cache',
      params: { uri: BOARD_URI },
    });
    const { result } = res.json();

    // Another process can change the value at any moment; subscribers learn of it from resources/updated.
    expect(result.ttlMs).toBe(0);
    // The stored value is the same for every caller, so an anonymous read is public, at a TTL of 0.
    expect(result.cacheScope).toBe('public');
  });
});
