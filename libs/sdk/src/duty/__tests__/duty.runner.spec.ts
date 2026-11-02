import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import type { DutyRunContext } from '../../common';
import { DutyRunner, type DutyLeaseStorage, type DutyLogger } from '../duty.runner';

const START = 1_700_000_000_000;
const EVERY_MS = 1_000;
const LEASE_MS = 3_000;
const KEY = 'demo:sweep';

interface Probe {
  runner: DutyRunner;
  runs: number[];
  logger: jest.Mocked<DutyLogger>;
}

function elapsed(): number {
  return Date.now() - START;
}

function probe(
  storage: DutyLeaseStorage,
  run: (context: DutyRunContext) => unknown = () => undefined,
  everyMs = EVERY_MS,
): Probe {
  const runs: number[] = [];
  const logger = { verbose: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const runner = new DutyRunner({
    name: 'sweep',
    key: KEY,
    everyMs,
    leaseMs: LEASE_MS,
    storage,
    logger,
    run: (context) => {
      runs.push(elapsed());
      return run(context);
    },
  });
  return { runner, runs, logger };
}

/** A view of the store whose operations wait while paused, as a stopped (SIGSTOP) or dead process's would. */
function pausable(storage: DutyLeaseStorage) {
  let gate: Promise<void> | undefined;
  let open: () => void = () => undefined;
  const through = <T>(operation: () => Promise<T>): Promise<T> => (gate ? gate.then(operation) : operation());
  const view: DutyLeaseStorage = {
    set: (key, value, options) => through(() => storage.set(key, value, options)),
    get: (key) => through(() => storage.get(key)),
    ttl: (key) => through(() => storage.ttl(key)),
    expireIfEquals: (key, value, ttlSeconds) => through(() => storage.expireIfEquals(key, value, ttlSeconds)),
    deleteIfEquals: (key, value) => through(() => storage.deleteIfEquals(key, value)),
  };
  return {
    storage: view,
    pause: () => {
      gate = new Promise((resolve) => (open = resolve));
    },
    resume: () => {
      gate = undefined;
      open();
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('DutyRunner', () => {
  let storage: RootStorage;
  let started: DutyRunner[];

  beforeEach(async () => {
    jest.useFakeTimers({ now: START });
    storage = createMemoryStorage();
    await storage.connect();
    started = [];
  });

  afterEach(async () => {
    const stopping = Promise.all(started.map((runner) => runner.stop()));
    await jest.runOnlyPendingTimersAsync();
    await stopping;
    await storage.disconnect();
    jest.useRealTimers();
  });

  async function start(...probes: Probe[]): Promise<void> {
    for (const { runner } of probes) {
      started.push(runner);
      await runner.start();
    }
  }

  it('runs on one holder only, once per interval, renewing the lease while it holds it', async () => {
    const first = probe(storage);
    const second = probe(storage);
    await start(first, second);

    await jest.advanceTimersByTimeAsync(10 * EVERY_MS);

    expect(first.runs).toEqual([0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000]);
    expect(second.runs).toEqual([]);
    expect(first.logger.info).toHaveBeenCalledWith('Duty "sweep" runs in this process every 1000 ms');
    expect(second.logger.info).not.toHaveBeenCalled();
  });

  it('skips a run that would overlap the one still running, instead of stacking it', async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    const holder = probe(storage, async () => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await delay(2_500);
      inFlight--;
    });
    await start(holder);

    await jest.advanceTimersByTimeAsync(10 * EVERY_MS);

    expect(holder.runs).toEqual([0, 3_000, 6_000, 9_000]);
    expect(mostInFlight).toBe(1);
    expect(holder.logger.verbose).toHaveBeenCalledWith('Duty "sweep" is still running; skipping this run');
  });

  it('logs a failed run and keeps the lease', async () => {
    let calls = 0;
    const holder = probe(storage, () => {
      calls++;
      if (calls === 1) throw new Error('disk full');
    });
    const other = probe(storage);
    await start(holder, other);

    await jest.advanceTimersByTimeAsync(2 * LEASE_MS);

    expect(holder.logger.error).toHaveBeenCalledWith('Duty "sweep" failed: disk full');
    expect(holder.runs).toEqual([0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000]);
    expect(other.runs).toEqual([]);
  });

  it('releases the lease on stop, and the next holder waits out the interval the last run started', async () => {
    const first = probe(storage, () => undefined, 5_000);
    const second = probe(storage, () => undefined, 5_000);
    await start(first, second);

    await jest.advanceTimersByTimeAsync(200);
    await first.runner.stop();
    await jest.advanceTimersByTimeAsync(12_000);

    expect(first.runs).toEqual([0]);
    expect(second.runs).toEqual([5_000, 10_000]);
    expect(second.logger.info).toHaveBeenCalledWith('Duty "sweep" runs in this process every 5000 ms');
  });

  it('takes over from a holder that died once its lease runs out', async () => {
    const dying = pausable(storage);
    const first = probe(dying.storage);
    const second = probe(storage);
    await start(first, second);

    await jest.advanceTimersByTimeAsync(500);
    dying.pause();
    await jest.advanceTimersByTimeAsync(6_000);

    expect(first.runs).toEqual([0]);
    const [takeover] = second.runs;
    expect(takeover).toBeGreaterThanOrEqual(LEASE_MS);
    expect(takeover).toBeLessThanOrEqual(500 + LEASE_MS + LEASE_MS / 3);
    expect(second.runs.map((at) => at - takeover)).toEqual([0, 1_000, 2_000, 3_000]);
    dying.resume();
  });

  it('never runs again in a holder that wakes from a pause after another process took the lease over', async () => {
    const sleeper = pausable(storage);
    const first = probe(sleeper.storage);
    const second = probe(storage);
    await start(first, second);

    await jest.advanceTimersByTimeAsync(500);
    sleeper.pause();
    await jest.advanceTimersByTimeAsync(6_000);
    sleeper.resume();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(first.runs).toEqual([0]);
    expect(first.logger.warn).toHaveBeenCalledWith('Duty "sweep" lost its lease; another process runs it now');
    expect(second.runs).toHaveLength(14);
  });

  it('aborts the run in flight when its lease is lost', async () => {
    let abortedAt: number | undefined;
    const holder = probe(
      storage,
      ({ signal }) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => {
            abortedAt = elapsed();
            resolve();
          }),
        ),
    );
    await start(holder);

    await jest.advanceTimersByTimeAsync(500);
    await storage.set(KEY, 'another-process', { ttlSeconds: 3 });
    await jest.advanceTimersByTimeAsync(1_000);

    expect(abortedAt).toBe(1_000);
    expect(holder.logger.warn).toHaveBeenCalledWith('Duty "sweep" lost its lease; another process runs it now');
  });

  it('aborts the run in flight on stop, and releases the lease once the run has ended', async () => {
    let runEnded = false;
    const holder = probe(
      storage,
      ({ signal }) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () =>
            setTimeout(() => {
              runEnded = true;
              resolve();
            }, 100),
          ),
        ),
    );
    await start(holder);
    await jest.advanceTimersByTimeAsync(500);

    let stopped = false;
    const stopping = holder.runner.stop().then(() => (stopped = true));
    await jest.advanceTimersByTimeAsync(50);
    expect(stopped).toBe(false);
    expect(await storage.get(KEY)).not.toBeNull();

    await jest.advanceTimersByTimeAsync(50);
    await stopping;
    expect(runEnded).toBe(true);
    expect(await storage.get(KEY)).toBeNull();
  });

  it('skips the run when the lease store fails, and keeps the lease once the store answers again', async () => {
    const holder = probe(storage);
    const other = probe(storage);
    await start(holder, other);

    await jest.advanceTimersByTimeAsync(900);
    const failing = jest.spyOn(storage, 'expireIfEquals').mockRejectedValue(new Error('database is locked'));
    await jest.advanceTimersByTimeAsync(200);
    failing.mockRestore();
    await jest.advanceTimersByTimeAsync(1_900);

    expect(holder.runs).toEqual([0, 2_000, 3_000]);
    expect(other.runs).toEqual([]);
    expect(holder.logger.warn).toHaveBeenCalledWith('Duty "sweep": the lease store failed: database is locked');
  });

  it('waits a whole interval before its first run when the store cannot say when the last run started', async () => {
    jest.spyOn(storage, 'ttl').mockRejectedValueOnce(new Error('database is locked'));
    const holder = probe(storage);
    await start(holder);

    await jest.advanceTimersByTimeAsync(3 * EVERY_MS);

    expect(holder.runs).toEqual([1_000, 2_000, 3_000]);
  });

  it('releases a lease that its first check got after stop() was called', async () => {
    const holder = probe(storage);
    started.push(holder.runner);

    const starting = holder.runner.start();
    await holder.runner.stop();
    await starting;
    await jest.advanceTimersByTimeAsync(5_000);

    expect(holder.runs).toEqual([]);
    expect(await storage.get(KEY)).toBeNull();
  });
});
