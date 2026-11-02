import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DistributedSemaphore } from '@frontmcp/guard';

import { SqliteStorageAdapter } from '../sqlite-storage.adapter';

describe('DistributedSemaphore on SQLite', () => {
  let dir: string;
  let first: SqliteStorageAdapter;
  let second: SqliteStorageAdapter;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-semaphore-'));
    const dbPath = path.join(dir, 'guard.sqlite');
    first = new SqliteStorageAdapter({ path: dbPath, ttlCleanupIntervalMs: 0 });
    second = new SqliteStorageAdapter({ path: dbPath, ttlCleanupIntervalMs: 0 });
    await first.connect();
    await second.connect();
  });

  afterEach(async () => {
    await first.disconnect();
    await second.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts the SQLite adapter as storage for concurrency slots', async () => {
    await expect(new DistributedSemaphore(first).verifyAtomicSlots()).resolves.toBeUndefined();
  });

  it('holds a slot for one caller at a time, across adapters on the same file', async () => {
    const semaphoreA = new DistributedSemaphore(first, 60);
    const semaphoreB = new DistributedSemaphore(second, 60);

    const ticket = await semaphoreA.acquire('job', 1, 0, 'job');
    expect(ticket).not.toBeNull();
    expect(await semaphoreB.acquire('job', 1, 0, 'job')).toBeNull();
    expect(await semaphoreB.getActiveCount('job')).toBe(1);

    await ticket?.release();
    const next = await semaphoreB.acquire('job', 1, 0, 'job');
    expect(next).not.toBeNull();
    await next?.release();
    expect(await semaphoreA.getActiveCount('job')).toBe(0);
  });

  it('lets a queued caller take the slot once it is released', async () => {
    const semaphore = new DistributedSemaphore(first, 60);
    const held = await semaphore.acquire('job', 1, 0, 'job');
    setTimeout(() => void held?.release(), 50);

    const queued = await semaphore.acquire('job', 1, 2000, 'job');
    expect(queued).not.toBeNull();
    await queued?.release();
  });

  it('does not let a stale release free a slot another ticket now holds', async () => {
    const semaphore = new DistributedSemaphore(first, 60);
    const stale = await semaphore.acquire('job', 1, 0, 'job');
    await first.set('job:slot:0', 'someone-else');

    await stale?.release();
    expect(await first.get('job:slot:0')).toBe('someone-else');
  });
});
