/**
 * Tests for StorageTaskStore (memory backend via @frontmcp/utils).
 */

import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import type { TaskRecord } from '../../task.types';
import { StorageTaskStore } from '../storage-task.store';

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

    it('lists in task-id order from a scan by default, a task an older instance wrote after the index started too', async () => {
      await store.create(makeRecord({ taskId: 'z-new' }));
      await writtenByAnOlderInstance('a-old');

      const page = await store.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['a-old', 'z-new']);
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

    it("lists a session's tasks in the order they were created, from its index, without scanning task keys", async () => {
      for (const taskId of ['z-first', 'a-second', 'm-third']) await indexed.create(makeRecord({ taskId }));
      await indexed.create(makeRecord({ sessionId: 'session-B', taskId: 'b-1' }));
      const scans = jest.spyOn(storage.root, 'keys');

      const firstPage = await indexed.list('session-A', { pageSize: 2 });
      const secondPage = await indexed.list('session-A', { pageSize: 2, cursor: firstPage.nextCursor });

      expect(firstPage.tasks.map((task) => task.taskId)).toEqual(['z-first', 'a-second']);
      expect(secondPage.tasks.map((task) => task.taskId)).toEqual(['m-third']);
      expect(secondPage.nextCursor).toBeUndefined();
      expect(scans).not.toHaveBeenCalled();
    });

    it('fills a page past the positions of deleted tasks', async () => {
      for (let index = 0; index < 4; index++) await indexed.create(makeRecord({ taskId: `t-${index}` }));
      await indexed.delete('t-0', 'session-A');
      await indexed.delete('t-1', 'session-A');

      const page = await indexed.list('session-A', { pageSize: 2 });

      expect(page.tasks.map((task) => task.taskId)).toEqual(['t-2', 't-3']);
      expect(page.nextCursor).toBeUndefined();
    });

    it('lists the tasks an earlier version stored without an index, scanning once, and the tasks created after them', async () => {
      for (const taskId of ['old-1', 'old-2']) await writtenByAnOlderInstance(taskId);
      const scans = jest.spyOn(storage.root, 'keys');

      await indexed.create(makeRecord({ taskId: 'new-1' }));
      const page = await indexed.list('session-A');
      await indexed.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['old-1', 'old-2', 'new-1']);
      expect(scans).toHaveBeenCalledTimes(1);
    });

    it("keeps a session's index count as long as its longest-lived task", async () => {
      await indexed.create(makeRecord({ taskId: 'short', expiresAt: Date.now() + 60_000 }));
      await indexed.create(makeRecord({ taskId: 'long', expiresAt: Date.now() + 7_200_000 }));
      await indexed.create(makeRecord({ taskId: 'short-again', expiresAt: Date.now() + 60_000 }));

      const remaining = await storage.namespace('index-count').ttl('session-A');

      expect(remaining).toBeGreaterThan(7_000);
      expect(remaining).toBeLessThanOrEqual(7_200);
    });

    it('does not list a task an older instance wrote after the index started, which is why it is not the default', async () => {
      await indexed.create(makeRecord({ taskId: 'z-new' }));
      await writtenByAnOlderInstance('a-old');

      const page = await indexed.list('session-A');

      expect(page.tasks.map((task) => task.taskId)).toEqual(['z-new']);
      expect(await indexed.get('a-old', 'session-A')).not.toBeNull();
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
