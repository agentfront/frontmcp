/**
 * E2E: ten processes share one SQLite file through `createStorage({ type: 'sqlite' })` while another
 * process holds the write lock. Every increment is counted once, one process takes the NX lock and the
 * semaphore slot, no SQLITE_BUSY reaches a caller, and no process's event loop stalls while it waits.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadBetterSqlite3 } from '@frontmcp/storage-sqlite';

import type { StorageWorkerResult } from '../fixture/storage-worker';
import { killAll, runTogether, spawnWorker, type Worker } from './helpers/workers';

const WORKERS = 10;
const INCREMENTS = 40;
const HOLD_MS = 1000;

function readCounter(dbPath: string): number {
  const db = new (loadBetterSqlite3())(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'total'").get() as { value: string } | undefined;
    return Number(row?.value);
  } finally {
    db.close();
  }
}

describe.each([
  ['WAL', true],
  ['rollback journal', false],
])('ten processes on one SQLite file (%s)', (_mode, walMode) => {
  let dir: string;
  let dbPath: string;
  let started: Worker<unknown>[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-runtime-sqlite-'));
    dbPath = path.join(dir, 'shared.sqlite');
  });

  afterEach(() => {
    killAll(started);
    started = [];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('counts every increment once, gives the lock to one process, and keeps every event loop running', async () => {
    const workers = Array.from({ length: WORKERS }, (_, index) =>
      spawnWorker<StorageWorkerResult>('storage-worker.ts', {
        DB_PATH: dbPath,
        WAL_MODE: String(walMode),
        INCREMENTS: String(INCREMENTS),
        WORKER_ID: `worker-${index}`,
      }),
    );
    started = workers;
    await Promise.all(workers.map((worker) => worker.waitFor('ready')));

    const holder = spawnWorker('lock-holder.ts', { DB_PATH: dbPath, HOLD_MS: String(HOLD_MS) });
    started = [...workers, holder];
    await holder.waitFor('ready');
    holder.send('go');
    await holder.waitFor('locked');

    const results = await runTogether(workers);
    await holder.result;

    const total = WORKERS * INCREMENTS;
    const values = results.flatMap((result) => result.incrValues).sort((a, b) => a - b);
    expect(results.flatMap((result) => result.errors)).toEqual([]);
    expect(values).toEqual(Array.from({ length: total }, (_, index) => index + 1));
    expect(readCounter(dbPath)).toBe(total);
    expect(results.filter((result) => result.holdsNxLock)).toHaveLength(1);
    expect(results.filter((result) => result.acquiredSlot)).toHaveLength(1);
    expect(Math.max(...results.map((result) => result.maxTimerGapMs))).toBeLessThan(HOLD_MS / 2);
  });
});
