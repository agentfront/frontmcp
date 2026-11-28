/**
 * Machine-wide admission (#1351): `jobs.admission` with `scope: 'machine'` counts the attempts of every process that
 * shares the job store, through leases in it. Each `MachineJobAdmission` here stands for one process.
 */
import * as os from 'os';
import * as path from 'path';

import { createStorage, mkdtemp, rm } from '@frontmcp/utils';

import { JobAdmissionLostError, JobAdmissionTimeoutError, JobStoreNotSupportedError } from '../../errors';
import { createJobAdmission, JobAdmission, MachineJobAdmission, type AdmissionLeaseStore } from '../job-admission';
import { type JobStateStore } from '../store/job-state.interface';
import { MemoryJobStateStore } from '../store/memory-job-state.store';
import { StorageJobStateStore } from '../store/storage-job-state.store';

const FAST = { recheckMs: 10, hostname: () => 'box-a' };
/** The key of box-a's leases in the store. */
const MACHINE = 'admission:box-a';

/** `store`, with each swap of its leases waiting for `before()` first. */
function delayedSwaps(store: AdmissionLeaseStore, before: () => Promise<unknown>): AdmissionLeaseStore {
  return {
    readLeases: (key) => store.readLeases(key),
    swapLeases: async (key, expected, next, ttlSeconds) => {
      await before();
      return store.swapLeases(key, expected, next, ttlSeconds);
    },
  };
}

async function leasesOf(store: AdmissionLeaseStore): Promise<Array<{ job: string }>> {
  const raw = await store.readLeases(MACHINE);
  return raw ? (JSON.parse(raw) as Array<{ job: string }>) : [];
}

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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
    const dead = { id: 'dead', memoryMb: 0, job: 'report', pid: 1, expiresAt: Date.now() + 1_000 };
    await store.swapLeases(MACHINE, '', JSON.stringify([dead]), 30);
    const admission = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, FAST);

    const slot = admission.slot();
    const acquiring = slot.acquire('report');
    expect(await admitted(acquiring, 200)).toBe(false);
    expect(await admitted(acquiring, 3_000)).toBe(true);
    slot.release();
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

  it('admits one attempt when a slow process writes its lease after another took the only slot', async () => {
    const store = new MemoryJobStateStore();
    let land: () => void = () => undefined;
    const landed = new Promise<void>((resolve) => (land = resolve));
    const slow = new MachineJobAdmission(
      { concurrency: 1, scope: 'machine' },
      delayedSwaps(store, () => landed),
      undefined,
      FAST,
    );
    const quick = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, FAST);
    const slowSlot = slow.slot();
    const slowAcquiring = slowSlot.acquire('slow');
    // The slow process read the empty list, and its write is still on its way
    await new Promise((resolve) => setTimeout(resolve, 50));
    const quickSlot = quick.slot();
    await quickSlot.acquire('quick');

    land();
    expect(await admitted(slowAcquiring, 300)).toBe(false);
    expect((await leasesOf(store)).map((lease) => lease.job)).toEqual(['quick']);
    quickSlot.release();
    expect(await admitted(slowAcquiring, 2_000)).toBe(true);
    slowSlot.release();
  });

  it('stops waiting on a job store that never answers when the attempt is aborted', async () => {
    const hanging: AdmissionLeaseStore = {
      readLeases: () => new Promise<string>(() => undefined),
      swapLeases: () => Promise.resolve(false),
    };
    const admission = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, hanging, undefined, FAST);
    const controller = new AbortController();

    const waiting = admission.slot().acquire('report', controller.signal);
    setTimeout(() => controller.abort(new Error('cancelled')), 50);

    await expect(waiting).rejects.toThrow('cancelled');
  });

  it('tells the attempt it lost its slot once its lease is gone from the store', async () => {
    const store = new MemoryJobStateStore();
    const admission = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, {
      ...FAST,
      leaseSeconds: 1,
    });
    const slot = admission.slot();
    await slot.acquire('report');
    // Another process found the lease ended and took the list over
    await store.swapLeases(MACHINE, await store.readLeases(MACHINE), '[]', 30);

    await waitFor(async () => slot.lost?.aborted === true, 'the slot to be lost');
    expect(slot.lost?.reason).toBeInstanceOf(JobAdmissionLostError);
    expect(slot.lost?.reason).toMatchObject({ code: 'JOB_ADMISSION_LOST' });
    slot.release();
  });

  it('tells the attempt it lost its slot while the renewals of its lease fail', async () => {
    const store = new MemoryJobStateStore();
    let failing = false;
    const flaky = delayedSwaps(store, async () => {
      if (failing) throw new Error('the store is gone');
    });
    const admission = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, flaky, undefined, {
      ...FAST,
      leaseSeconds: 1,
    });
    const slot = admission.slot();
    await slot.acquire('report');
    failing = true;

    await waitFor(async () => slot.lost?.aborted === true, 'the slot to be lost');
    expect(slot.lost?.reason).toMatchObject({ code: 'JOB_ADMISSION_LOST' });
    slot.release();
  });

  it('keeps waiting, and says why, while the job store fails', async () => {
    const failing: AdmissionLeaseStore = {
      readLeases: () => Promise.reject(new Error('the store is gone')),
      swapLeases: () => Promise.resolve(false),
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

  describe('on a clock the test moves', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: 1_700_000_000_000 });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** Settle what the store's answers start, without moving the clock. */
    async function settle(): Promise<void> {
      for (let round = 0; round < 20; round++) await jest.advanceTimersByTimeAsync(0);
    }

    /** The outcome of `acquiring` once it settles: 'admitted', or what it rejected with. */
    function outcomeOf(acquiring: Promise<void>): { value?: unknown } {
      const outcome: { value?: unknown } = {};
      acquiring.then(
        () => (outcome.value = 'admitted'),
        (error: unknown) => (outcome.value = error),
      );
      return outcome;
    }

    it('refuses at maxWaitMs while the job store does not answer, and frees a slot its late answer took', async () => {
      const store = new MemoryJobStateStore();
      let wrote: () => void = () => undefined;
      const written = new Promise<void>((resolve) => (wrote = resolve));
      let answer: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => (answer = resolve));
      const lateStore: AdmissionLeaseStore = {
        readLeases: (key) => store.readLeases(key),
        swapLeases: async (key, expected, next, ttlSeconds) => {
          const swapped = await store.swapLeases(key, expected, next, ttlSeconds);
          wrote();
          await answered;
          return swapped;
        },
      };
      const admission = new MachineJobAdmission(
        { concurrency: 1, maxWaitMs: 100, scope: 'machine' },
        lateStore,
        undefined,
        FAST,
      );

      const outcome = outcomeOf(admission.slot().acquire('report'));
      await written;
      await jest.advanceTimersByTimeAsync(99);
      expect(outcome.value).toBeUndefined();
      await jest.advanceTimersByTimeAsync(1);
      await settle();
      expect(outcome.value).toBeInstanceOf(JobAdmissionTimeoutError);
      expect((outcome.value as Error).message).toContain('the job store did not answer in time');
      expect(await leasesOf(store)).toHaveLength(1);

      answer();
      await settle();
      expect(await leasesOf(store)).toEqual([]);
    });

    it('renews the lease of a running attempt, so a long attempt keeps its slot', async () => {
      const store = new MemoryJobStateStore();
      const probes = { ...FAST, leaseSeconds: 1 };
      const first = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, probes);
      const second = new MachineJobAdmission({ concurrency: 1, scope: 'machine' }, store, undefined, probes);
      const running = first.slot();
      await running.acquire('report');

      const waiting = second.slot();
      const outcome = outcomeOf(waiting.acquire('report'));
      await jest.advanceTimersByTimeAsync(5_000);
      expect(outcome.value).toBeUndefined();
      expect(running.lost?.aborted).toBe(false);
      running.release();
      await jest.advanceTimersByTimeAsync(100);
      expect(outcome.value).toBe('admitted');
      waiting.release();
    });
  });

  describe('on a SQLite job store two processes share', () => {
    let dir: string;
    const stores: JobStateStore[] = [];

    beforeEach(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), 'sdk-admission-'));
    });

    afterEach(async () => {
      for (const store of stores.splice(0)) await store.dispose();
      await rm(dir, { recursive: true, force: true });
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
