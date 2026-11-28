/**
 * Machine-wide admission (#1351): `jobs.admission` with `scope: 'machine'` counts the attempts of every process that
 * shares the job store, through leases in it. Each `MachineJobAdmission` here stands for one process.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createStorage } from '@frontmcp/utils';

import { JobAdmissionTimeoutError, JobStoreNotSupportedError } from '../../errors';
import { createJobAdmission, JobAdmission, MachineJobAdmission, type AdmissionLeaseStore } from '../job-admission';
import { type JobStateStore } from '../store/job-state.interface';
import { MemoryJobStateStore } from '../store/memory-job-state.store';
import { StorageJobStateStore } from '../store/storage-job-state.store';

const FAST = { recheckMs: 10, hostname: () => 'box-a' };

async function admitted(acquiring: Promise<void>, withinMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), withinMs)));
  try {
    return await Promise.race([acquiring.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

describe('MachineJobAdmission', () => {
  it('holds an attempt of another process past the machine concurrency until the running one releases its slot', async () => {
    const store = new MemoryJobStateStore();
    const first = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, FAST);
    const second = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, FAST);
    const running = first.slot();
    await running.acquire('report');

    const waiting = second.slot();
    const acquiring = waiting.acquire('report');
    expect(await admitted(acquiring, 100)).toBe(false);

    running.release();
    expect(await admitted(acquiring, 2_000)).toBe(true);
    waiting.release();
  });

  it('counts the memory the attempts of every process claimed, and says why an attempt waited past maxWaitMs', async () => {
    const store = new MemoryJobStateStore();
    const probes = { ...FAST, freeMemoryMb: () => 3_000 };
    const options = { memoryMb: 2_000, maxWaitMs: 100, scope: 'machine' as const };
    const first = new MachineJobAdmission(options, store, undefined, probes);
    const second = new MachineJobAdmission(options, store, undefined, probes);
    const running = first.slot();
    await running.acquire('index');

    const refused = second.slot().acquire('index');
    await expect(refused).rejects.toBeInstanceOf(JobAdmissionTimeoutError);
    await expect(refused).rejects.toThrow('it needs 2000 MB free, and 1000 MB is on this machine');
    running.release();
  });

  it('takes over the slot of a process that died once its lease ends', async () => {
    const store = new MemoryJobStateStore();
    // A process that took the only slot, then died: nothing renews its lease
    await store.holdLease('admission:box-a:slot:dead', JSON.stringify({ memoryMb: 0, job: 'report', pid: 1 }), 1);
    const admission = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, FAST);

    const slot = admission.slot();
    const acquiring = slot.acquire('report');
    expect(await admitted(acquiring, 200)).toBe(false);
    expect(await admitted(acquiring, 3_000)).toBe(true);
    slot.release();
  });

  it('renews the lease of a running attempt, so a long attempt keeps its slot', async () => {
    const store = new MemoryJobStateStore();
    const probes = { ...FAST, leaseSeconds: 1 };
    const first = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, probes);
    const second = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, probes);
    const running = first.slot();
    await running.acquire('report');

    const waiting = second.slot();
    const acquiring = waiting.acquire('report');
    expect(await admitted(acquiring, 2_500)).toBe(false);
    running.release();
    expect(await admitted(acquiring, 2_000)).toBe(true);
    waiting.release();
  });

  it("counts only this machine's attempts", async () => {
    const store = new MemoryJobStateStore();
    const here = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, FAST);
    const elsewhere = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, {
      ...FAST,
      hostname: () => 'box-b',
    });
    const running = here.slot();
    await running.acquire('report');

    const other = elsewhere.slot();
    expect(await admitted(other.acquire('report'), 1_000)).toBe(true);
    running.release();
    other.release();
  });

  it('stops waiting when the attempt is aborted', async () => {
    const store = new MemoryJobStateStore();
    const admission = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, FAST);
    const running = admission.slot();
    await running.acquire('report');
    const controller = new AbortController();

    const waiting = admission.slot().acquire('report', controller.signal);
    controller.abort(new Error('cancelled'));

    await expect(waiting).rejects.toThrow('cancelled');
    running.release();
  });

  it('keeps waiting, and says why, while the job store fails', async () => {
    const failing: AdmissionLeaseStore = {
      holdLease: () => Promise.reject(new Error('the store is gone')),
      renewLease: () => Promise.resolve(false),
      releaseLease: () => Promise.resolve(),
      listLeases: () => Promise.resolve([]),
    };
    const reported: string[] = [];
    const admission = new MachineJobAdmission(
      { concurrency: 1, maxWaitMs: 50, scope: 'machine' },
      failing,
      (message) => reported.push(message),
      FAST,
    );

    await expect(admission.slot().acquire('report')).rejects.toThrow(
      'the job store could not be read (the store is gone)',
    );
    expect(reported[0]).toBe('Job admission: the job store failed: the store is gone');
  });

  describe('on a SQLite job store two processes share', () => {
    let dir: string;
    const stores: JobStateStore[] = [];

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-admission-'));
    });

    afterEach(async () => {
      for (const store of stores.splice(0)) await store.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    async function openStore(): Promise<StorageJobStateStore> {
      const storage = await createStorage({
        type: 'sqlite',
        sqlite: { path: path.join(dir, 'jobs.sqlite') },
        prefix: 'mcp:jobs:',
        fallback: 'error',
      });
      const store = new StorageJobStateStore(storage);
      stores.push(store);
      return store;
    }

    it('admits one attempt at a time across the connections', async () => {
      const first = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, await openStore(), undefined, FAST);
      const second = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, await openStore(), undefined, FAST);
      const running = first.slot();
      await running.acquire('report');

      const waiting = second.slot();
      const acquiring = waiting.acquire('report');
      expect(await admitted(acquiring, 200)).toBe(false);

      running.release();
      expect(await admitted(acquiring, 3_000)).toBe(true);
      waiting.release();
    });
  });
});

describe('createJobAdmission', () => {
  it('makes none without jobs.admission, and a per-process one without scope', () => {
    const store = new MemoryJobStateStore();
    expect(createJobAdmission(undefined, store)).toBeUndefined();
    expect(createJobAdmission({ concurrency: 2 }, store)).toBeInstanceOf(JobAdmission);
    expect(createJobAdmission({ concurrency: 2, scope: 'process' }, store)).toBeInstanceOf(JobAdmission);
    expect(createJobAdmission({ concurrency: 2, scope: 'machine' }, store)).toBeInstanceOf(MachineJobAdmission);
  });

  it('refuses machine scope on a job store that keeps no leases', () => {
    const store = new MemoryJobStateStore();
    const withoutLeases: JobStateStore = {
      createRun: (record) => store.createRun(record),
      updateRun: (runId, updates) => store.updateRun(runId, updates),
      getRun: (runId) => store.getRun(runId),
      listRuns: (opts) => store.listRuns(opts),
      cleanup: (olderThanMs) => store.cleanup(olderThanMs),
      dispose: () => store.dispose(),
    };

    expect(() => createJobAdmission({ scope: 'machine' }, withoutLeases)).toThrow(JobStoreNotSupportedError);
  });
});
