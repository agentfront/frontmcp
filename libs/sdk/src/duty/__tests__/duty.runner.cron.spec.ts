import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import type { DutyRunContext } from '../../common';
import { loadCronSchedule, type CronSchedule } from '../cron-schedule';
import { DutyRunner, type DutyLogger } from '../duty.runner';

const START = new Date('2026-11-10T08:59:30Z').getTime();
const MINUTE = 60_000;
const DAY = 86_400_000;
const LEASE_MS = 3_000;
const KEY = 'demo:report';

interface Probe {
  runner: DutyRunner;
  runs: string[];
  logger: jest.Mocked<DutyLogger>;
}

function clock(): string {
  return new Date().toISOString().slice(11, 23);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('DutyRunner with a cron', () => {
  let storage: RootStorage;
  let everyMinute: CronSchedule;
  let started: DutyRunner[];

  beforeEach(async () => {
    jest.useFakeTimers({ now: START });
    storage = createMemoryStorage({ enableSweeper: false });
    await storage.connect();
    everyMinute = await loadCronSchedule({ expression: '* * * * *', timezone: 'UTC' });
    started = [];
  });

  afterEach(async () => {
    const stopping = Promise.all(started.map((runner) => runner.stop()));
    await jest.runOnlyPendingTimersAsync();
    await stopping;
    await storage.disconnect();
    jest.useRealTimers();
  });

  function probe(
    cron: CronSchedule = everyMinute,
    run: (context: DutyRunContext) => unknown = () => undefined,
    leaseMs = LEASE_MS,
  ): Probe {
    const runs: string[] = [];
    const logger = { verbose: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const runner = new DutyRunner({
      name: 'report',
      key: KEY,
      cron,
      leaseMs,
      storage,
      logger,
      run: (context) => {
        runs.push(clock());
        return run(context);
      },
    });
    return { runner, runs, logger };
  }

  async function start(...probes: Probe[]): Promise<void> {
    for (const { runner } of probes) {
      started.push(runner);
      await runner.start();
    }
  }

  it('runs at each scheduled time in one holder, and not when it starts', async () => {
    const first = probe();
    const second = probe();
    await start(first, second);

    await jest.advanceTimersByTimeAsync(3 * MINUTE);

    expect(first.runs).toEqual(['09:00:00.000', '09:01:00.000', '09:02:00.000']);
    expect(second.runs).toEqual([]);
    expect(first.logger.info).toHaveBeenCalledWith('Duty "report" runs in this process on cron "* * * * *" (UTC)');
  });

  it('reads the schedule in its time zone', async () => {
    const nineInBerlin = await loadCronSchedule({ expression: '0 9 * * *', timezone: 'Europe/Berlin' });
    const holder = probe(nineInBerlin, () => undefined, 600_000);
    await start(holder);

    await jest.advanceTimersByTimeAsync(DAY);

    expect(holder.runs).toEqual(['08:00:00.000']);
  });

  it('runs once at a takeover for the scheduled times nothing ran, then on schedule', async () => {
    const first = probe();
    await start(first);
    await jest.advanceTimersByTimeAsync(MINUTE);
    await first.runner.stop();

    await jest.advanceTimersByTimeAsync(3 * MINUTE + 15_000);
    const second = probe();
    await start(second);
    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(first.runs).toEqual(['09:00:00.000']);
    expect(second.runs).toEqual(['09:03:45.000', '09:04:00.000', '09:05:00.000']);
  });

  it('runs once at a takeover for a scheduled time that passed before the first run ever', async () => {
    const first = probe();
    await start(first);
    await jest.advanceTimersByTimeAsync(10_000);
    await first.runner.stop();

    await jest.advanceTimersByTimeAsync(MINUTE);
    const second = probe();
    await start(second);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(first.runs).toEqual([]);
    expect(second.runs).toEqual(['09:00:40.000']);
  });

  it('does not run again at a takeover for a scheduled time that already ran', async () => {
    const first = probe();
    const second = probe();
    await start(first, second);
    await jest.advanceTimersByTimeAsync(40_000);
    await first.runner.stop();

    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(first.runs).toEqual(['09:00:00.000']);
    expect(second.runs).toEqual(['09:01:00.000', '09:02:00.000']);
  });

  it('runs each scheduled time once among runners that hand the lease over right after a run', async () => {
    const runs: string[] = [];
    const contender = () => probe(everyMinute, () => void runs.push(clock()));
    const contenders = [contender(), contender(), contender()];
    await start(...contenders);
    await jest.advanceTimersByTimeAsync(30_000);

    for (let minute = 1; minute <= 5; minute++) {
      const holder = contenders.find((each) => each.runs.length > 0);
      if (!holder) throw new Error('no contender ran');
      await holder.runner.stop();
      const next = contender();
      contenders.splice(contenders.indexOf(holder), 1, next);
      await start(next);
      await jest.advanceTimersByTimeAsync(MINUTE);
    }

    expect(runs).toEqual([
      '09:00:00.000',
      '09:01:00.000',
      '09:02:00.000',
      '09:03:00.000',
      '09:04:00.000',
      '09:05:00.000',
    ]);
  });

  it('skips a scheduled time that comes while the last run is still running', async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    const holder = probe(everyMinute, async () => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await delay(90_000);
      inFlight--;
    });
    await start(holder);

    await jest.advanceTimersByTimeAsync(5 * MINUTE);

    expect(holder.runs).toEqual(['09:00:00.000', '09:02:00.000', '09:04:00.000']);
    expect(mostInFlight).toBe(1);
    expect(holder.logger.verbose).toHaveBeenCalledWith('Duty "report" is still running; skipping this run');
  });

  it('runs a scheduled time that came while an earlier check was still waiting on the store', async () => {
    const readLedger = storage.get.bind(storage);
    jest.spyOn(storage, 'get').mockImplementationOnce(async (key) => {
      await delay(40_000);
      return readLedger(key);
    });
    const holder = probe();
    await start(holder);

    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(holder.runs).toEqual(['09:00:10.000', '09:01:00.000']);
    expect(holder.logger.verbose).not.toHaveBeenCalledWith('Duty "report" is still running; skipping this run');
  });

  it('waits for a time further away than a timer can hold, in several waits', async () => {
    const inThirtyDays = await loadCronSchedule({ expression: '0 0 10 12 *', timezone: 'UTC' });
    const holder = probe(inThirtyDays, () => undefined, 20 * DAY);
    await start(holder);

    await jest.advanceTimersByTimeAsync(29 * DAY);
    expect(holder.runs).toEqual([]);

    await jest.advanceTimersByTimeAsync(DAY);
    expect(holder.runs).toEqual(['00:00:00.000']);
  });

  it('waits again when the clock was set back before the scheduled time', async () => {
    const holder = probe();
    await start(holder);

    jest.setSystemTime(START - 20_000);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(holder.runs).toEqual([]);

    await jest.advanceTimersByTimeAsync(20_000);
    expect(holder.runs).toEqual(['09:00:00.000']);
  });

  it('runs once for the scheduled times a clock jump skipped, then on schedule', async () => {
    const holder = probe(everyMinute, () => undefined, 30 * MINUTE);
    await start(holder);
    await jest.advanceTimersByTimeAsync(MINUTE);

    jest.setSystemTime(START + 10 * MINUTE + 10_000);
    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(holder.runs).toEqual(['09:00:00.000', '09:10:10.000', '09:11:00.000']);
  });

  it('skips the run when the store cannot say what ran, and makes up for it at the next scheduled time', async () => {
    const holder = probe();
    await start(holder);
    await jest.advanceTimersByTimeAsync(20_000);

    const failing = jest.spyOn(storage, 'get').mockRejectedValue(new Error('database is locked'));
    await jest.advanceTimersByTimeAsync(20_000);
    failing.mockRestore();
    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(holder.runs).toEqual(['09:01:00.000']);
    expect(holder.logger.warn).toHaveBeenCalledWith('Duty "report": the lease store failed: database is locked');
  });

  it('logs a failed run, keeps the lease and runs at the next scheduled time', async () => {
    let calls = 0;
    const holder = probe(everyMinute, () => {
      calls++;
      if (calls === 1) throw new Error('disk full');
    });
    const other = probe();
    await start(holder, other);

    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(holder.logger.error).toHaveBeenCalledWith('Duty "report" failed: disk full');
    expect(holder.runs).toEqual(['09:00:00.000', '09:01:00.000']);
    expect(other.runs).toEqual([]);
  });

  it('never runs when stop() was called while its first check got the lease', async () => {
    const holder = probe();
    started.push(holder.runner);

    const starting = holder.runner.start();
    await holder.runner.stop();
    await starting;
    await jest.advanceTimersByTimeAsync(3 * MINUTE);

    expect(holder.runs).toEqual([]);
    expect(await storage.get(KEY)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});
