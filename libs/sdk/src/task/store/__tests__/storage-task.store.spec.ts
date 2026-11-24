/**
 * Tests for StorageTaskStore (memory backend via @frontmcp/utils).
 */

import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import type { TaskRecord } from '../../task.types';
import { StorageTaskStore } from '../storage-task.store';
import type { TaskSessionIndex } from '../task-session-index';

function makeRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: 'session-A',
    status: 'working',
    statusMessage: 'in progress',
    createdAt: nowIso,
    lastUpdatedAt: nowIso,
    ttlMs: 60_000,
    pollIntervalMs: 2_000,
    expiresAt: now + 60_000,
    request: { method: 'tools/call', params: { name: 'test', arguments: { a: 1 } } },
    ...overrides,
  };
}

describe('StorageTaskStore', () => {
  let storage: RootStorage;
  let store: StorageTaskStore;

  /** A task record as an instance before the per-session index stores it: the record alone. */
  async function writtenByAnOlderInstance(taskId: string): Promise<void> {
    await storage.namespace('records').set(`session-A:${taskId}`, JSON.stringify(makeRecord({ taskId })), {
      ttlSeconds: 60,
    });
  }

  beforeEach(async () => {
    storage = createMemoryStorage({ prefix: 'test:task:' });
    await storage.connect();
    store = new StorageTaskStore(storage);
  });

  afterEach(async () => {
    await store.destroy();
    await storage.disconnect();
  });

  describe('create/get/delete', () => {
    it('creates and retrieves a record', async () => {
      const rec = makeRecord();
      await store.create(rec);
      expect(await store.get(rec.taskId, rec.sessionId)).toEqual(rec);
    });

    it('returns null for unknown task', async () => {
      expect(await store.get('does-not-exist', 'session-A')).toBeNull();
    });

    it('returns null for cross-session access (hard session binding)', async () => {
      const rec = makeRecord({ sessionId: 'session-A' });
      await store.create(rec);
      expect(await store.get(rec.taskId, 'session-B')).toBeNull();
    });

    it('deletes a record', async () => {
      const rec = makeRecord();
      await store.create(rec);
      await store.delete(rec.taskId, rec.sessionId);
      expect(await store.get(rec.taskId, rec.sessionId)).toBeNull();
    });

    it('does not store an already-expired record', async () => {
      const rec = makeRecord({ expiresAt: Date.now() - 1000 });
      await store.create(rec);
      expect(await store.get(rec.taskId, rec.sessionId)).toBeNull();
    });
  });

  describe('update', () => {
    it('applies partial patch and bumps lastUpdatedAt', async () => {
      const rec = makeRecord();
      await store.create(rec);
      await new Promise((r) => setTimeout(r, 2));
      const updated = await store.update(rec.taskId, rec.sessionId, {
        status: 'completed',
        statusMessage: 'done',
      });
      expect(updated?.status).toBe('completed');
      expect(updated?.statusMessage).toBe('done');
      expect(new Date(updated!.lastUpdatedAt).getTime()).toBeGreaterThan(new Date(rec.lastUpdatedAt).getTime());
      // Identity fields must not change.
      expect(updated?.taskId).toBe(rec.taskId);
      expect(updated?.sessionId).toBe(rec.sessionId);
      expect(updated?.createdAt).toBe(rec.createdAt);
    });

    it('returns null when updating a record from a different session', async () => {
      const rec = makeRecord({ sessionId: 'session-A' });
      await store.create(rec);
      const res = await store.update(rec.taskId, 'session-B', { status: 'completed' });
      expect(res).toBeNull();
    });
  });

  describe('list', () => {
    it('returns only tasks owned by the given session', async () => {
      const a1 = makeRecord({ sessionId: 'session-A', taskId: 'a-1' });
      const a2 = makeRecord({ sessionId: 'session-A', taskId: 'a-2' });
      const b1 = makeRecord({ sessionId: 'session-B', taskId: 'b-1' });
      await store.create(a1);
      await store.create(a2);
      await store.create(b1);

      const pageA = await store.list('session-A');
      const idsA = pageA.tasks.map((t) => t.taskId).sort();
      expect(idsA).toEqual(['a-1', 'a-2']);

      const pageB = await store.list('session-B');
      const idsB = pageB.tasks.map((t) => t.taskId).sort();
      expect(idsB).toEqual(['b-1']);
    });

    it('paginates via nextCursor', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create(makeRecord({ sessionId: 'session-A', taskId: `t-${i}` }));
      }
      const page1 = await store.list('session-A', { pageSize: 2 });
      expect(page1.tasks).toHaveLength(2);
      expect(page1.nextCursor).toBeDefined();
      const page2 = await store.list('session-A', { pageSize: 2, cursor: page1.nextCursor });
      expect(page2.tasks).toHaveLength(2);
      expect(page2.nextCursor).toBeDefined();
      const page3 = await store.list('session-A', { pageSize: 2, cursor: page2.nextCursor });
      expect(page3.tasks).toHaveLength(1);
      expect(page3.nextCursor).toBeUndefined();
    });

    it('returns an empty page when session has no tasks', async () => {
      const page = await store.list('session-with-nothing');
      expect(page.tasks).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });

    it('lists from the index by default, in the order the tasks were written', async () => {
      for (const taskId of ['z-first', 'a-second']) await store.create(makeRecord({ taskId }));

      const page = await store.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['z-first', 'a-second']);
    });

    it("lists in task-id order under tasks.listFrom: 'scan', a task an older instance wrote after the index started too", async () => {
      const scanning = new StorageTaskStore(storage, undefined, { listFrom: 'scan' });
      await scanning.create(makeRecord({ taskId: 'z-new' }));
      await writtenByAnOlderInstance('a-old');

      const page = await scanning.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['a-old', 'z-new']);
      await scanning.destroy();
    });

    it('goes on with a cursor in the order its first page was read in, whichever source the next instance lists from', async () => {
      const scanning = new StorageTaskStore(storage, undefined, { listFrom: 'scan' });
      for (const taskId of ['z-first', 'a-second', 'm-third']) await store.create(makeRecord({ taskId }));

      const fromIndex = await store.list('session-A', { pageSize: 1 });
      const indexGoesOn = await scanning.list('session-A', { pageSize: 1, cursor: fromIndex.nextCursor });
      const fromScan = await scanning.list('session-A', { pageSize: 1 });
      const scanGoesOn = await store.list('session-A', { pageSize: 1, cursor: fromScan.nextCursor });

      expect([fromIndex, indexGoesOn].map((page) => page.tasks[0].taskId)).toEqual(['z-first', 'a-second']);
      expect([fromScan, scanGoesOn].map((page) => page.tasks[0].taskId)).toEqual(['a-second', 'm-third']);
      await scanning.destroy();
    });
  });

  describe("list with tasks.listFrom: 'index'", () => {
    let indexed: StorageTaskStore;

    beforeEach(() => {
      indexed = new StorageTaskStore(storage, undefined, { listFrom: 'index' });
    });

    afterEach(async () => {
      await indexed.destroy();
    });

    it('numbers a task it writes without scanning any task key, in either mode', async () => {
      const scans = jest.spyOn(storage.root, 'keys');

      await indexed.create(makeRecord({ taskId: 'first' }));
      await store.create(makeRecord({ sessionId: 'session-B', taskId: 'second' }));

      expect(scans).not.toHaveBeenCalled();
    });

    it("lists a session's tasks in the order they were written, scanning the task keys once for the session", async () => {
      for (const taskId of ['z-first', 'a-second', 'm-third']) await indexed.create(makeRecord({ taskId }));
      await indexed.create(makeRecord({ sessionId: 'session-B', taskId: 'b-1' }));
      const scans = jest.spyOn(storage.root, 'keys');

      const firstPage = await indexed.list('session-A', { pageSize: 2 });
      const secondPage = await indexed.list('session-A', { pageSize: 2, cursor: firstPage.nextCursor });
      await indexed.list('session-A');

      expect(firstPage.tasks.map((task) => task.taskId)).toEqual(['z-first', 'a-second']);
      expect(secondPage.tasks.map((task) => task.taskId)).toEqual(['m-third']);
      expect(secondPage.nextCursor).toBeUndefined();
      expect(scans).toHaveBeenCalledTimes(1);
    });

    it('fills a page past the positions of deleted tasks, and starts a first page after those at the head', async () => {
      for (let index = 0; index < 4; index++) await indexed.create(makeRecord({ taskId: `t-${index}` }));
      await indexed.delete('t-0', 'session-A');
      await indexed.delete('t-1', 'session-A');

      const page = await indexed.list('session-A', { pageSize: 2 });
      const again = await indexed.list('session-A', { pageSize: 2 });

      expect(page.tasks.map((task) => task.taskId)).toEqual(['t-2', 't-3']);
      expect(page.nextCursor).toBeUndefined();
      expect(await storage.namespace('index-start').get('session-A')).toBe('2');
      expect(again.tasks.map((task) => task.taskId)).toEqual(['t-2', 't-3']);
    });

    it('lists the tasks an earlier version stored without an index, and the tasks written after them', async () => {
      for (const taskId of ['old-1', 'old-2']) await writtenByAnOlderInstance(taskId);

      await indexed.create(makeRecord({ taskId: 'new-1' }));
      const page = await indexed.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['new-1', 'old-1', 'old-2']);
    });

    it('indexes the earlier tasks once when two lists race, listing each task once', async () => {
      for (const taskId of ['old-1', 'old-2']) await writtenByAnOlderInstance(taskId);

      const pages = await Promise.all([indexed.list('session-A'), indexed.list('session-A')]);

      for (const page of pages) expect(page.tasks.map((task) => task.taskId).sort()).toEqual(['old-1', 'old-2']);
      expect(await storage.namespace('index-count').get('session-A')).toBe('2');
    });

    it("keeps a session's index count as long as a task can live, plus the hour its positions outlive it", async () => {
      await indexed.create(makeRecord({ taskId: 'long', expiresAt: Date.now() + 7_200_000 }));
      await indexed.create(makeRecord({ taskId: 'short', expiresAt: Date.now() + 60_000 }));

      const remaining = await storage.namespace('index-count').ttl('session-A');

      expect(remaining).toBeGreaterThan(89_000);
      expect(remaining).toBeLessThanOrEqual(90_000);
    });

    it('never starts a first page after a task whose record is still being written', async () => {
      await indexed.create(makeRecord({ taskId: 't-0' }));
      await indexed.delete('t-0', 'session-A');
      const sessionIndex = await (
        indexed as unknown as { loadSessionIndex(): Promise<TaskSessionIndex> }
      ).loadSessionIndex();
      await sessionIndex.add(makeRecord({ taskId: 'in-flight' }), 60);
      await indexed.create(makeRecord({ taskId: 't-2' }));

      const whileWriting = await indexed.list('session-A');
      await storage
        .namespace('records')
        .set('session-A:in-flight', JSON.stringify(makeRecord({ taskId: 'in-flight' })));
      const written = await indexed.list('session-A');

      expect(whileWriting.tasks.map((task) => task.taskId)).toEqual(['t-2']);
      expect(await storage.namespace('index-start').get('session-A')).toBe('1');
      expect(written.tasks.map((task) => task.taskId)).toEqual(['in-flight', 't-2']);
    });

    it('goes on in task-id order with a cursor from a page listed from the scan while another request indexed', async () => {
      for (const taskId of ['c', 'a', 'b']) await indexed.create(makeRecord({ taskId }));
      await storage.namespace('index-ready').set('session-A', 'running:another-request', { ttlSeconds: 60 });

      const firstPage = await indexed.list('session-A', { pageSize: 2 });
      await storage.namespace('index-ready').set('session-A', 'done', { ttlSeconds: 60 });
      const secondPage = await indexed.list('session-A', { pageSize: 2, cursor: firstPage.nextCursor });

      expect(firstPage.tasks.map((task) => task.taskId)).toEqual(['a', 'b']);
      expect(secondPage.tasks.map((task) => task.taskId)).toEqual(['c']);
    });

    it("keeps a task's index entry as long as its record when an update moves its expiry later", async () => {
      await indexed.create(makeRecord({ taskId: 'extended', expiresAt: Date.now() + 60_000 }));

      await indexed.update('extended', 'session-A', { expiresAt: Date.now() + 7_200_000 });

      expect(await storage.namespace('index-of').ttl('session-A:extended')).toBeGreaterThan(7_000);
      expect(await storage.namespace('index').ttl('session-A:1')).toBeGreaterThan(10_000);
    });

    it('does not list a task an older instance writes after the session was indexed, so an upgrade lists from the scan until it ends', async () => {
      await indexed.create(makeRecord({ taskId: 'z-new' }));
      await indexed.list('session-A');
      await writtenByAnOlderInstance('a-old');

      const page = await indexed.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['z-new']);
      expect(await indexed.get('a-old', 'session-A')).not.toBeNull();
    });
  });

  describe('the per-session index', () => {
    let indexed: StorageTaskStore;

    beforeEach(() => {
      indexed = new StorageTaskStore(storage, undefined, { listFrom: 'index', maxTtlMs: 1_500 });
    });

    afterEach(async () => {
      await indexed.destroy();
    });

    it('keeps its count for whole seconds when tasks.maxTtlMs is not a multiple of 1000', async () => {
      const expiries = jest.spyOn(storage.root, 'expire');

      await indexed.create(makeRecord({ taskId: 'short', expiresAt: Date.now() + 1_500 }));

      expect(expiries.mock.calls.every(([, ttlSeconds]) => Number.isInteger(ttlSeconds))).toBe(true);
      expect(await indexed.list('session-A')).toEqual({ tasks: [expect.objectContaining({ taskId: 'short' })] });
    });

    it('keeps its count alive past a task an update extended, and a later task never shortens it', async () => {
      await indexed.create(makeRecord({ taskId: 'extended', expiresAt: Date.now() + 1_000 }));
      await indexed.update('extended', 'session-A', { expiresAt: Date.now() + 7_200_000 });
      await indexed.create(makeRecord({ taskId: 'later', expiresAt: Date.now() + 1_000 }));

      expect(await storage.namespace('index-count').ttl('session-A')).toBeGreaterThan(10_000);
    });

    it('renews its backfill claim while it indexes the earlier tasks', async () => {
      await writtenByAnOlderInstance('old-1');
      const expiries = jest.spyOn(storage.root, 'expire');

      await indexed.list('session-A');

      expect(expiries).toHaveBeenCalledWith(expect.stringContaining('index-ready:session-A'), 60);
    });

    it('numbers again an earlier task whose index-of key has no position, left by a request that died', async () => {
      await writtenByAnOlderInstance('old-1');
      await storage.namespace('index-of').set('session-A:old-1', '7', { ttlSeconds: 60 });

      const page = await indexed.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['old-1']);
    });

    it('leaves unnumbered an earlier task that expires while the backfill runs', async () => {
      const realNow = Date.now.bind(Date);
      let skewMs = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skewMs);
      await storage
        .namespace('records')
        .set('session-A:fading', JSON.stringify(makeRecord({ taskId: 'fading', expiresAt: realNow() + 2_000 })), {
          ttlSeconds: 60,
        });
      const rootMget = storage.root.mget.bind(storage.root);
      jest.spyOn(storage.root, 'mget').mockImplementation(async (keys: string[]) => {
        if (keys.some((key) => key.includes('index-of:'))) skewMs = 5_000;
        return rootMget(keys);
      });

      await expect(indexed.list('session-A')).resolves.toEqual({ tasks: [] });
      expect(await storage.namespace('index-of').get('session-A:fading')).toBeNull();
      jest.restoreAllMocks();
    });

    it('starts a first page after the positions whose keys expired, once every write before them has settled', async () => {
      for (const taskId of ['t-1', 't-2', 't-3']) await indexed.create(makeRecord({ taskId }));
      for (const taskId of ['t-1', 't-2']) {
        await storage.namespace('records').delete(`session-A:${taskId}`);
        await storage.namespace('index-of').delete(`session-A:${taskId}`);
      }
      for (const position of [1, 2]) await storage.namespace('index').delete(`session-A:${position}`);
      await storage.namespace('index-settled').set('session-A', `2:${Date.now() - 120_000}`, { ttlSeconds: 60 });

      const page = await indexed.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['t-3']);
      expect(await storage.namespace('index-start').get('session-A')).toBe('2');
    });

    it('keeps reading an empty position numbered after the last settled write, which may be a write in progress', async () => {
      await indexed.create(makeRecord({ taskId: 't-1' }));
      await storage.namespace('index').delete('session-A:1');
      await storage.namespace('index-settled').set('session-A', `1:${Date.now()}`, { ttlSeconds: 60 });

      await indexed.list('session-A');

      expect(await storage.namespace('index-start').get('session-A')).toBeNull();
    });
  });

  describe('pub/sub', () => {
    it('delivers terminal notifications to subscribers', async () => {
      const rec = makeRecord();
      await store.create(rec);

      const received: TaskRecord[] = [];
      const unsubscribe = await store.subscribeTerminal(rec.taskId, rec.sessionId, (r) => received.push(r));

      const terminal: TaskRecord = { ...rec, status: 'completed', statusMessage: 'ok' };
      await store.publishTerminal(terminal);

      // Memory storage pub/sub is synchronous-ish; give a microtask.
      await new Promise((r) => setImmediate(r));
      expect(received).toHaveLength(1);
      expect(received[0].status).toBe('completed');
      await unsubscribe();
    });

    it('delivers cancel signals to subscribers', async () => {
      const rec = makeRecord();
      await store.create(rec);
      let fired = 0;
      const unsubscribe = await store.subscribeCancel(rec.taskId, rec.sessionId, () => fired++);
      await store.publishCancel(rec.taskId, rec.sessionId);
      await new Promise((r) => setImmediate(r));
      expect(fired).toBe(1);
      await unsubscribe();
    });
  });
});
