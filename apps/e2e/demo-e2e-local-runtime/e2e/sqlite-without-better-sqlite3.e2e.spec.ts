/**
 * E2E: processes that cannot load better-sqlite3 run the SQLite stores on Node's node:sqlite, on the same file as
 * processes that can: increments, an NX lock and duty leases stay exact across both.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { StorageWorkerResult } from '../fixture/storage-worker';
import { killAll, runTogether, spawnWorker, type Worker } from './helpers/workers';

const WITHOUT_BETTER_SQLITE3 = {
  NODE_OPTIONS: `--require ${path.join(__dirname, 'helpers', 'without-better-sqlite3.cjs')}`,
};
const HOLD_MS = 1000;

function runsOf(workers: Worker<unknown>[]): number[] {
  return workers.flatMap(({ lines }) =>
    lines.filter((line) => line.startsWith('ran ')).map((line) => Number(line.split(' ')[1])),
  );
}

async function waitUntil(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('SQLite stores without better-sqlite3', () => {
  let dir: string;
  let started: Worker<unknown>[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-runtime-node-sqlite-'));
  });

  afterEach(() => {
    killAll(started);
    started = [];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('counts every increment once and gives the lock to one process, next to processes on better-sqlite3', async () => {
    const dbPath = path.join(dir, 'shared.sqlite');
    const workers = Array.from({ length: 6 }, (_, index) =>
      spawnWorker<StorageWorkerResult>('storage-worker.ts', {
        DB_PATH: dbPath,
        WAL_MODE: 'true',
        INCREMENTS: '30',
        WORKER_ID: `worker-${index}`,
        ...(index < 4 ? WITHOUT_BETTER_SQLITE3 : {}),
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

    const values = results.flatMap((result) => result.incrValues).sort((a, b) => a - b);
    expect(results.flatMap((result) => result.errors)).toEqual([]);
    expect(values).toEqual(Array.from({ length: 6 * 30 }, (_, index) => index + 1));
    expect(results.filter((result) => result.holdsNxLock)).toHaveLength(1);
    expect(results.filter((result) => result.acquiredSlot)).toHaveLength(1);
    expect(Math.max(...results.map((result) => result.maxTimerGapMs))).toBeLessThan(HOLD_MS / 2);
  });

  it('runs a duty in one of two servers, and the other takes it over when the holder dies', async () => {
    const workers = Array.from({ length: 2 }, () =>
      spawnWorker('duty-server.ts', {
        FRONTMCP_HOME: dir,
        EVERY_MS: '300',
        LEASE_MS: '3000',
        ...WITHOUT_BETTER_SQLITE3,
      }),
    );
    started = workers;
    await Promise.all(workers.map((worker) => worker.waitFor('ready')));

    await waitUntil(() => runsOf(workers).length >= 3, 30_000, 'three runs');
    const holders = new Set(runsOf(workers));
    expect(holders.size).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'duties.sqlite')).subarray(0, 15).toString()).toBe('SQLite format 3');

    const [holderPid] = holders;
    const holder = workers.find(({ child }) => child.pid === holderPid);
    const survivor = workers.find(({ child }) => child.pid !== holderPid);
    holder?.child.kill('SIGKILL');
    await waitUntil(() => runsOf(survivor ? [survivor] : []).length >= 2, 20_000, 'a takeover');
  });
});
