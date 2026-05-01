import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SqliteTaskStore, type SqliteTaskLogger, type TaskRecord } from '../sqlite-task.store';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-task-'));
  return path.join(dir, 'test.sqlite');
}

function cleanup(dbPath: string): void {
  try {
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function makeRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = Date.now();
  return {
    taskId: 't-1',
    sessionId: 's-1',
    status: 'working',
    createdAt: new Date(now).toISOString(),
    lastUpdatedAt: new Date(now).toISOString(),
    ttlMs: 60_000,
    expiresAt: now + 60_000,
    request: { method: 'tools/call', params: { name: 'echo', arguments: { msg: 'hi' } } },
    ...overrides,
  };
}

describe('SqliteTaskStore', () => {
  let store: SqliteTaskStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new SqliteTaskStore({
      path: dbPath,
      ttlCleanupIntervalMs: 0,
    });
  });

  afterEach(async () => {
    await store.destroy();
    cleanup(dbPath);
  });

  describe('constructor', () => {
    it('throws on invalid db path', () => {
      expect(
        () =>
          new SqliteTaskStore({
            path: '/this/path/should/not/exist/db.sqlite',
            ttlCleanupIntervalMs: 0,
          }),
      ).toThrow(/failed to open database/i);
    });

    it('honors walMode=false', () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({ path: p, ttlCleanupIntervalMs: 0, walMode: false });
      const mode = s.getDatabase().pragma('journal_mode', { simple: true }) as string;
      expect(mode.toLowerCase()).not.toBe('wal');
      void s.destroy();
      cleanup(p);
    });

    it('defaults to WAL mode when walMode is omitted', () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({ path: p, ttlCleanupIntervalMs: 0 });
      const mode = s.getDatabase().pragma('journal_mode', { simple: true }) as string;
      expect(mode.toLowerCase()).toBe('wal');
      void s.destroy();
      cleanup(p);
    });

    it('starts cleanup timer when ttlCleanupIntervalMs > 0', async () => {
      jest.useFakeTimers();
      const p = tmpDbPath();
      const s = new SqliteTaskStore({ path: p, ttlCleanupIntervalMs: 100 });
      const expired = makeRecord({ taskId: 'expired-1', expiresAt: Date.now() + 1 });
      await s.create(expired);
      // Advance past expiration + cleanup interval
      jest.advanceTimersByTime(200);
      // Run pending timers
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      await s.destroy();
      cleanup(p);
    });
  });

  describe('create', () => {
    it('persists a task record', async () => {
      const rec = makeRecord();
      await store.create(rec);
      const got = await store.get(rec.taskId, rec.sessionId);
      expect(got).toEqual(rec);
    });

    it('skips records that are already expired', async () => {
      const warn = jest.fn();
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        logger: { warn } as SqliteTaskLogger,
      });
      const rec = makeRecord({ taskId: 'expired', expiresAt: Date.now() - 1 });
      await s.create(rec);
      const got = await s.get(rec.taskId, rec.sessionId);
      expect(got).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('already expired'),
        expect.objectContaining({ taskId: 'expired' }),
      );
      await s.destroy();
      cleanup(p);
    });

    it('serializes executor pid in the indexed column', async () => {
      const rec = makeRecord({ executor: { host: 'cli', pid: 4242 } });
      await store.create(rec);
      const row = store
        .getDatabase()
        .prepare('SELECT executor_pid FROM mcp_tasks WHERE task_id = ?')
        .get(rec.taskId) as { executor_pid: number };
      expect(row.executor_pid).toBe(4242);
    });

    it('stores null executor_pid when missing', async () => {
      const rec = makeRecord();
      await store.create(rec);
      const row = store
        .getDatabase()
        .prepare('SELECT executor_pid FROM mcp_tasks WHERE task_id = ?')
        .get(rec.taskId) as { executor_pid: number | null };
      expect(row.executor_pid).toBeNull();
    });
  });

  describe('get', () => {
    it('returns null when task not found', async () => {
      expect(await store.get('missing', 'no-session')).toBeNull();
    });

    it('returns null and deletes when row is expired', async () => {
      const rec = makeRecord({ expiresAt: Date.now() + 50 });
      await store.create(rec);
      // Move past expiry by directly mutating DB
      store
        .getDatabase()
        .prepare('UPDATE mcp_tasks SET expires_at = ? WHERE task_id = ?')
        .run(Date.now() - 1, rec.taskId);
      expect(await store.get(rec.taskId, rec.sessionId)).toBeNull();
      const count = (
        store.getDatabase().prepare('SELECT COUNT(*) as n FROM mcp_tasks WHERE task_id = ?').get(rec.taskId) as {
          n: number;
        }
      ).n;
      expect(count).toBe(0);
    });

    it('orphan-detects dead CLI executor and transitions to failed', async () => {
      const dead = jest.fn().mockReturnValue(false);
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        livenessProbe: dead,
      });
      const rec = makeRecord({
        status: 'working',
        executor: { host: 'cli', pid: 9999 },
      });
      await s.create(rec);

      const terminalEvents: TaskRecord[] = [];
      await s.subscribeTerminal(rec.taskId, rec.sessionId, (r) => terminalEvents.push(r));

      const got = await s.get(rec.taskId, rec.sessionId);
      expect(got?.status).toBe('failed');
      expect(got?.statusMessage).toMatch(/runner exited/i);
      expect(dead).toHaveBeenCalledWith(9999);

      // Wait for emitter
      await new Promise((r) => setImmediate(r));
      expect(terminalEvents).toHaveLength(1);
      expect(terminalEvents[0]?.status).toBe('failed');

      await s.destroy();
      cleanup(p);
    });

    it('does not orphan-detect when executor is in-process', async () => {
      const probe = jest.fn().mockReturnValue(false);
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        livenessProbe: probe,
      });
      const rec = makeRecord({
        status: 'working',
        executor: { host: 'in-process', pid: 1 },
      });
      await s.create(rec);
      const got = await s.get(rec.taskId, rec.sessionId);
      expect(got?.status).toBe('working');
      expect(probe).not.toHaveBeenCalled();
      await s.destroy();
      cleanup(p);
    });

    it('does not orphan-detect when status is terminal', async () => {
      const probe = jest.fn().mockReturnValue(false);
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        livenessProbe: probe,
      });
      const rec = makeRecord({
        status: 'completed',
        executor: { host: 'cli', pid: 9999 },
      });
      await s.create(rec);
      const got = await s.get(rec.taskId, rec.sessionId);
      expect(got?.status).toBe('completed');
      expect(probe).not.toHaveBeenCalled();
      await s.destroy();
      cleanup(p);
    });

    it('does not orphan-detect when CLI executor pid is alive', async () => {
      const alive = jest.fn().mockReturnValue(true);
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        livenessProbe: alive,
      });
      const rec = makeRecord({
        status: 'input_required',
        executor: { host: 'cli', pid: 1234 },
      });
      await s.create(rec);
      const got = await s.get(rec.taskId, rec.sessionId);
      expect(got?.status).toBe('input_required');
      expect(alive).toHaveBeenCalledWith(1234);
      await s.destroy();
      cleanup(p);
    });

    it('does not orphan-detect when CLI executor pid is missing', async () => {
      const probe = jest.fn().mockReturnValue(false);
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        livenessProbe: probe,
      });
      const rec = makeRecord({
        status: 'working',
        executor: { host: 'cli' },
      });
      await s.create(rec);
      const got = await s.get(rec.taskId, rec.sessionId);
      expect(got?.status).toBe('working');
      expect(probe).not.toHaveBeenCalled();
      await s.destroy();
      cleanup(p);
    });
  });

  describe('default liveness probe', () => {
    it('returns true for the current process', async () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({ path: p, ttlCleanupIntervalMs: 0 });
      const rec = makeRecord({
        status: 'working',
        executor: { host: 'cli', pid: process.pid },
      });
      await s.create(rec);
      const got = await s.get(rec.taskId, rec.sessionId);
      // Process is alive — should remain working
      expect(got?.status).toBe('working');
      await s.destroy();
      cleanup(p);
    });

    it('returns false for a guaranteed-dead PID', async () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({ path: p, ttlCleanupIntervalMs: 0 });
      // Use PID 1 with a high signal that we don't have permission to send,
      // OR use a large bogus PID. PID 0 / negative are special — pick a huge number.
      const rec = makeRecord({
        status: 'working',
        executor: { host: 'cli', pid: 2_147_483_640 },
      });
      await s.create(rec);
      const got = await s.get(rec.taskId, rec.sessionId);
      // Default liveness probe will throw ESRCH and report dead → orphan-detect
      expect(got?.status).toBe('failed');
      await s.destroy();
      cleanup(p);
    });
  });

  describe('update', () => {
    it('returns null when task does not exist', async () => {
      const result = await store.update('missing', 's', { status: 'completed' });
      expect(result).toBeNull();
    });

    it('returns null and deletes when row is expired before patch', async () => {
      const rec = makeRecord();
      await store.create(rec);
      store
        .getDatabase()
        .prepare('UPDATE mcp_tasks SET expires_at = ? WHERE task_id = ?')
        .run(Date.now() - 1, rec.taskId);
      const result = await store.update(rec.taskId, rec.sessionId, { status: 'completed' });
      expect(result).toBeNull();
      const count = (store.getDatabase().prepare('SELECT COUNT(*) as n FROM mcp_tasks').get() as { n: number }).n;
      expect(count).toBe(0);
    });

    it('returns null and deletes when patched expiresAt has already passed', async () => {
      const rec = makeRecord();
      await store.create(rec);
      const result = await store.update(rec.taskId, rec.sessionId, {
        expiresAt: Date.now() - 1,
      });
      expect(result).toBeNull();
      const count = (store.getDatabase().prepare('SELECT COUNT(*) as n FROM mcp_tasks').get() as { n: number }).n;
      expect(count).toBe(0);
    });

    it('preserves identity fields and refreshes lastUpdatedAt', async () => {
      const rec = makeRecord();
      await store.create(rec);
      const before = await store.get(rec.taskId, rec.sessionId);
      // tiny wait so lastUpdatedAt is strictly newer
      await new Promise((r) => setTimeout(r, 5));
      const updated = await store.update(rec.taskId, rec.sessionId, {
        status: 'completed',
        outcome: { kind: 'ok', data: { result: 42 } },
        // even if caller tries to clobber identity, store should ignore
        taskId: 'CLOBBER',
        sessionId: 'CLOBBER',
        createdAt: 'CLOBBER',
      } as Partial<TaskRecord>);
      expect(updated).not.toBeNull();
      expect(updated?.taskId).toBe(rec.taskId);
      expect(updated?.sessionId).toBe(rec.sessionId);
      expect(updated?.createdAt).toBe(rec.createdAt);
      expect(updated?.status).toBe('completed');
      expect(updated?.outcome).toEqual({ kind: 'ok', data: { result: 42 } });
      expect(new Date(updated!.lastUpdatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before!.lastUpdatedAt).getTime(),
      );
    });

    it('persists executor.pid through updates', async () => {
      const rec = makeRecord({ executor: { host: 'cli', pid: 1111 } });
      await store.create(rec);
      const updated = await store.update(rec.taskId, rec.sessionId, {
        executor: { host: 'cli', pid: 2222 },
      });
      expect(updated?.executor?.pid).toBe(2222);
      const row = store
        .getDatabase()
        .prepare('SELECT executor_pid FROM mcp_tasks WHERE task_id = ?')
        .get(rec.taskId) as { executor_pid: number };
      expect(row.executor_pid).toBe(2222);
    });

    it('writes null executor_pid when executor cleared', async () => {
      const rec = makeRecord({ executor: { host: 'cli', pid: 1111 } });
      await store.create(rec);
      const updated = await store.update(rec.taskId, rec.sessionId, { executor: undefined });
      expect(updated?.executor).toBeUndefined();
      const row = store
        .getDatabase()
        .prepare('SELECT executor_pid FROM mcp_tasks WHERE task_id = ?')
        .get(rec.taskId) as { executor_pid: number | null };
      expect(row.executor_pid).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the task', async () => {
      const rec = makeRecord();
      await store.create(rec);
      await store.delete(rec.taskId, rec.sessionId);
      expect(await store.get(rec.taskId, rec.sessionId)).toBeNull();
    });

    it('is a no-op for non-existent task', async () => {
      await expect(store.delete('missing', 's')).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns empty page when no tasks', async () => {
      const page = await store.list('s-1');
      expect(page.tasks).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });

    it('returns tasks for the given session only', async () => {
      await store.create(makeRecord({ taskId: 'a', sessionId: 's-1' }));
      await store.create(makeRecord({ taskId: 'b', sessionId: 's-2' }));
      const page = await store.list('s-1');
      expect(page.tasks.map((t) => t.taskId)).toEqual(['a']);
    });

    it('paginates and returns nextCursor when more rows remain', async () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        await store.create(
          makeRecord({
            taskId: `t-${i}`,
            sessionId: 's-1',
            createdAt: new Date(now + i).toISOString(),
          }),
        );
      }
      const page1 = await store.list('s-1', { pageSize: 2 });
      expect(page1.tasks.map((t) => t.taskId)).toEqual(['t-0', 't-1']);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await store.list('s-1', { pageSize: 2, cursor: page1.nextCursor });
      expect(page2.tasks.map((t) => t.taskId)).toEqual(['t-2', 't-3']);
      expect(page2.nextCursor).toBeDefined();

      const page3 = await store.list('s-1', { pageSize: 2, cursor: page2.nextCursor });
      expect(page3.tasks.map((t) => t.taskId)).toEqual(['t-4']);
      expect(page3.nextCursor).toBeUndefined();
    });

    it('clamps pageSize to bounds', async () => {
      await store.create(makeRecord({ taskId: 'only', sessionId: 's-1' }));
      const lo = await store.list('s-1', { pageSize: 0 });
      expect(lo.tasks).toHaveLength(1); // clamped to 1, only 1 task
      const hi = await store.list('s-1', { pageSize: 1000 });
      expect(hi.tasks).toHaveLength(1);
    });

    it('falls back to offset 0 for an unparseable cursor', async () => {
      await store.create(makeRecord({ taskId: 'only', sessionId: 's-1' }));
      const page = await store.list('s-1', { cursor: 'totally-not-base64!!!' });
      expect(page.tasks).toHaveLength(1);
    });

    it('falls back to offset 0 when cursor decodes to a negative offset', async () => {
      await store.create(makeRecord({ taskId: 'only', sessionId: 's-1' }));
      const bogus = Buffer.from(JSON.stringify({ offset: -5 })).toString('base64url');
      const page = await store.list('s-1', { cursor: bogus });
      expect(page.tasks).toHaveLength(1);
    });

    it('falls back to offset 0 when cursor decodes to a non-integer offset', async () => {
      await store.create(makeRecord({ taskId: 'only', sessionId: 's-1' }));
      const bogus = Buffer.from(JSON.stringify({ offset: 1.5 })).toString('base64url');
      const page = await store.list('s-1', { cursor: bogus });
      expect(page.tasks).toHaveLength(1);
    });

    it('excludes expired rows from results', async () => {
      const now = Date.now();
      await store.create(makeRecord({ taskId: 'fresh', sessionId: 's-1', expiresAt: now + 60_000 }));
      // bypass the create-side expiry check to force an expired row in the DB
      const expiredRec = makeRecord({ taskId: 'old', sessionId: 's-1' });
      await store.create(expiredRec);
      store
        .getDatabase()
        .prepare('UPDATE mcp_tasks SET expires_at = ? WHERE task_id = ?')
        .run(now - 1, 'old');
      const page = await store.list('s-1');
      expect(page.tasks.map((t) => t.taskId)).toEqual(['fresh']);
    });

    it('orphan-detects dead CLI executor in listed tasks', async () => {
      const dead = jest.fn().mockReturnValue(false);
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        livenessProbe: dead,
      });
      const rec = makeRecord({
        taskId: 'orphan',
        status: 'working',
        executor: { host: 'cli', pid: 9999 },
      });
      await s.create(rec);
      const events: TaskRecord[] = [];
      await s.subscribeTerminal(rec.taskId, rec.sessionId, (r) => events.push(r));

      const page = await s.list(rec.sessionId);
      expect(page.tasks).toHaveLength(1);
      expect(page.tasks[0].status).toBe('failed');
      await new Promise((r) => setImmediate(r));
      expect(events).toHaveLength(1);
      await s.destroy();
      cleanup(p);
    });

    it('does not orphan-detect listed tasks with non-cli executor', async () => {
      const probe = jest.fn().mockReturnValue(false);
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        livenessProbe: probe,
      });
      await s.create(
        makeRecord({
          taskId: 'in-proc',
          status: 'working',
          executor: { host: 'in-process' },
        }),
      );
      const page = await s.list('s-1');
      expect(page.tasks[0].status).toBe('working');
      expect(probe).not.toHaveBeenCalled();
      await s.destroy();
      cleanup(p);
    });
  });

  describe('pub/sub', () => {
    it('subscribeTerminal receives publishTerminal events', async () => {
      const rec = makeRecord();
      const events: TaskRecord[] = [];
      await store.subscribeTerminal(rec.taskId, rec.sessionId, (r) => events.push(r));
      await store.publishTerminal(rec);
      await new Promise((r) => setImmediate(r));
      expect(events).toEqual([rec]);
    });

    it('unsubscribe removes the listener', async () => {
      const rec = makeRecord();
      const events: TaskRecord[] = [];
      const unsub = await store.subscribeTerminal(rec.taskId, rec.sessionId, (r) => events.push(r));
      await unsub();
      await store.publishTerminal(rec);
      await new Promise((r) => setImmediate(r));
      expect(events).toHaveLength(0);
    });

    it('subscribeCancel receives publishCancel events', async () => {
      const cancels: number[] = [];
      await store.subscribeCancel('t-1', 's-1', () => cancels.push(1));
      await store.publishCancel('t-1', 's-1');
      await new Promise((r) => setImmediate(r));
      expect(cancels).toEqual([1]);
    });

    it('cancel unsubscribe removes the listener', async () => {
      const cancels: number[] = [];
      const unsub = await store.subscribeCancel('t-1', 's-1', () => cancels.push(1));
      await unsub();
      await store.publishCancel('t-1', 's-1');
      await new Promise((r) => setImmediate(r));
      expect(cancels).toHaveLength(0);
    });
  });

  describe('purgeExpired', () => {
    it('deletes only expired rows and returns count', async () => {
      const now = Date.now();
      await store.create(makeRecord({ taskId: 'fresh', expiresAt: now + 60_000 }));
      await store.create(makeRecord({ taskId: 'expired-1' }));
      await store.create(makeRecord({ taskId: 'expired-2' }));
      // force two rows to be expired in DB
      store
        .getDatabase()
        .prepare('UPDATE mcp_tasks SET expires_at = ? WHERE task_id IN (?, ?)')
        .run(now - 1, 'expired-1', 'expired-2');
      const purged = store.purgeExpired();
      expect(purged).toBe(2);
      const remaining = (store.getDatabase().prepare('SELECT COUNT(*) as n FROM mcp_tasks').get() as { n: number }).n;
      expect(remaining).toBe(1);
    });

    it('returns 0 and logs when prepared statement throws', async () => {
      const warn = jest.fn();
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        logger: { warn } as SqliteTaskLogger,
      });
      // force cleanup statement to throw
      const stmts = (s as unknown as { stmts: { cleanup: { run: () => unknown } } }).stmts;
      stmts.cleanup.run = () => {
        throw new Error('boom');
      };
      const result = s.purgeExpired();
      expect(result).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('purgeExpired failed'),
        expect.objectContaining({ error: 'boom' }),
      );
      await s.destroy();
      cleanup(p);
    });

    it('returns 0 with non-Error throwable', async () => {
      const warn = jest.fn();
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        logger: { warn } as SqliteTaskLogger,
      });
      const stmts = (s as unknown as { stmts: { cleanup: { run: () => unknown } } }).stmts;
      stmts.cleanup.run = () => {
        throw 'string-thrown';
      };
      expect(s.purgeExpired()).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('purgeExpired failed'),
        expect.objectContaining({ error: 'string-thrown' }),
      );
      await s.destroy();
      cleanup(p);
    });
  });

  describe('destroy', () => {
    it('clears the cleanup timer when one was started', async () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({ path: p, ttlCleanupIntervalMs: 1000 });
      // No assertion needed beyond destroy not throwing — the timer was created internally.
      await expect(s.destroy()).resolves.toBeUndefined();
      cleanup(p);
    });

    it('swallows errors during db.close', async () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({ path: p, ttlCleanupIntervalMs: 0 });
      // Replace db.close with a thrower
      const db = s.getDatabase();
      (db as unknown as { close: () => void }).close = () => {
        throw new Error('close failed');
      };
      await expect(s.destroy()).resolves.toBeUndefined();
      cleanup(p);
    });

    it('removes all subscribers', async () => {
      const cb = jest.fn();
      await store.subscribeTerminal('t', 's', cb);
      await store.subscribeCancel('t', 's', cb);
      await store.destroy();
      // Re-create for afterEach to clean up safely
      store = new SqliteTaskStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    });
  });

  describe('encryption', () => {
    it('round-trips records through encrypted storage', async () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        encryption: { secret: 'a-very-long-secret-string-with-enough-entropy' },
      });
      const rec = makeRecord({
        request: { method: 'tools/call', params: { name: 'sensitive', arguments: { token: 'abc' } } },
      });
      await s.create(rec);
      const got = await s.get(rec.taskId, rec.sessionId);
      expect(got?.request.params).toEqual({ name: 'sensitive', arguments: { token: 'abc' } });

      // Verify the on-disk record_json is NOT plaintext JSON
      const raw = (
        s.getDatabase().prepare('SELECT record_json FROM mcp_tasks WHERE task_id = ?').get(rec.taskId) as {
          record_json: string;
        }
      ).record_json;
      expect(raw).not.toContain('sensitive');
      expect(() => JSON.parse(raw)).toThrow();
      await s.destroy();
      cleanup(p);
    });

    it('encrypted updates also round-trip', async () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({
        path: p,
        ttlCleanupIntervalMs: 0,
        encryption: { secret: 'another-very-long-test-secret-with-entropy' },
      });
      const rec = makeRecord();
      await s.create(rec);
      const updated = await s.update(rec.taskId, rec.sessionId, {
        status: 'completed',
        outcome: { kind: 'error', error: { code: 1, message: 'nope' } },
      });
      expect(updated?.status).toBe('completed');
      expect(updated?.outcome).toEqual({ kind: 'error', error: { code: 1, message: 'nope' } });
      const reloaded = await s.get(rec.taskId, rec.sessionId);
      expect(reloaded).toEqual(updated);
      await s.destroy();
      cleanup(p);
    });
  });

  describe('prepared statements not initialized', () => {
    it('throws when statements are reset', async () => {
      const p = tmpDbPath();
      const s = new SqliteTaskStore({ path: p, ttlCleanupIntervalMs: 0 });
      (s as unknown as { stmts: unknown }).stmts = null;
      await expect(s.create(makeRecord())).rejects.toThrow(/prepared statements not initialized/);
      // Restore so destroy works
      (s as unknown as { prepareStatements: () => void }).prepareStatements();
      await s.destroy();
      cleanup(p);
    });
  });
});
