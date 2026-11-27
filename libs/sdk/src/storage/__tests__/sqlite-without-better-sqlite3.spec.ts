/** The SQLite stores of 1.12 on a machine without better-sqlite3: they open their files with Node's node:sqlite. */
import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, readFileBuffer, rm } from '@frontmcp/utils';

import { LeaseHolder } from '../../duty/lease-holder';
import { leaseStorageConfig, openLeaseStore } from '../../duty/lease-store';
import { createJobStateStore } from '../../job/store/job-state-store.factory';
import { prepareSharedDirectory, sharedServerFiles } from '../../shared/shared-files';
import { openStartLockStorage, SharedStartLock } from '../../shared/start-lock';

jest.mock('../../../../storage-sqlite/src/better-sqlite3-loader', () => ({
  loadBetterSqlite3: jest.fn(() => {
    throw Object.assign(new Error("Cannot find module 'better-sqlite3'"), { code: 'MODULE_NOT_FOUND' });
  }),
}));

const SQLITE_HEADER = 'SQLite format 3';

async function isSqliteFile(file: string): Promise<boolean> {
  return (await readFileBuffer(file)).subarray(0, SQLITE_HEADER.length).toString() === SQLITE_HEADER;
}

const posixOnly = process.platform === 'win32' ? it.skip : it;

describe('the SQLite stores without better-sqlite3', () => {
  let home: string;
  const previousHome = process.env['FRONTMCP_HOME'];
  const previousDriver = process.env['FRONTMCP_SQLITE_DRIVER'];

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'sdk-node-sqlite-'));
    process.env['FRONTMCP_HOME'] = home;
    delete process.env['FRONTMCP_SQLITE_DRIVER'];
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    if (previousDriver !== undefined) process.env['FRONTMCP_SQLITE_DRIVER'] = previousDriver;
    await rm(home, { recursive: true, force: true });
  });

  posixOnly("let one launcher of runShared() hold a key's start lock", async () => {
    const files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    const [one, two] = await Promise.all([openStartLockStorage(files), openStartLockStorage(files)]);
    try {
      const first = new SharedStartLock(one, 'notes');
      const second = new SharedStartLock(two, 'notes');

      expect(await Promise.all([first.acquire(), second.acquire()])).toEqual([true, false]);
      await first.release();
      expect(await second.acquire()).toBe(true);
      expect(await isSqliteFile(files.lockFile)).toBe(true);
    } finally {
      await one.disconnect();
      await two.disconnect();
    }
  });

  it('give a duty lease to one holder, and to the next once it is released', async () => {
    const config = leaseStorageConfig(undefined, 'duty', 'machine');
    const [one, two] = await Promise.all([openLeaseStore(config), openLeaseStore(config)]);
    const logger = { info: jest.fn(), warn: jest.fn() };
    const holder = (storage: typeof one, onAcquired: () => void) =>
      new LeaseHolder({
        label: 'Duty "sweep"',
        key: 'sweep',
        leaseMs: 30_000,
        storage,
        logger,
        onAcquired,
        onLost: jest.fn(),
      });
    const acquired: string[] = [];
    const first = holder(one, () => void acquired.push('first'));
    const second = holder(two, () => void acquired.push('second'));
    const next = holder(two, () => void acquired.push('next'));
    try {
      await first.start();
      await second.start();
      expect(acquired).toEqual(['first']);

      await first.stop(() => true);
      await next.start();
      expect(acquired).toEqual(['first', 'next']);
      expect(await isSqliteFile(path.join(home, 'duties.sqlite'))).toBe(true);
    } finally {
      for (const leaseHolder of [first, second, next]) await leaseHolder.stop(() => true);
      await one.disconnect();
      await two.disconnect();
    }
  });

  it('keep job runs in jobs.store.sqlite, where another store on the file reads them', async () => {
    const file = path.join(home, 'jobs', 'runs.sqlite');
    const writer = await createJobStateStore({ sqlite: { path: file } });
    const reader = await createJobStateStore({ sqlite: { path: file } });
    try {
      await writer.store.createRun({
        runId: 'run-1',
        jobId: 'job-1',
        jobName: 'report',
        state: 'running',
        input: { day: 1 },
        startedAt: Date.now(),
        attempt: 1,
        maxAttempts: 1,
        logs: [],
        background: true,
      });

      expect(writer.type).toBe('sqlite');
      expect(await reader.store.getRun('run-1')).toEqual(
        expect.objectContaining({ jobName: 'report', state: 'running' }),
      );
      expect(await isSqliteFile(file)).toBe(true);
    } finally {
      await writer.store.dispose();
      await reader.store.dispose();
    }
  });
});
