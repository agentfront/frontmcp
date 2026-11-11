import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { loadCronSchedule, takeDueRun, type CronSchedule } from '../cron-schedule';

const KEY = 'demo:report:ran';

function at(iso: string): number {
  return new Date(iso).getTime();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** The scheduled times after `from`, one after another. */
function timesAfter(schedule: CronSchedule, from: string, count: number): string[] {
  const times: string[] = [];
  let after = at(from);
  for (let index = 0; index < count; index++) {
    after = schedule.nextAfter(after);
    times.push(iso(after));
  }
  return times;
}

async function reasonOf(expression: string, timezone = 'UTC'): Promise<string> {
  return loadCronSchedule({ expression, timezone }).then(
    () => 'read',
    (error: Error) => error.message,
  );
}

describe('loadCronSchedule', () => {
  it('keeps the expression and its time zone', async () => {
    const schedule = await loadCronSchedule({ expression: '0 9 * * 1-5', timezone: 'Europe/Berlin' });

    expect(schedule.expression).toBe('0 9 * * 1-5');
    expect(schedule.timezone).toBe('Europe/Berlin');
  });

  it('reads five fields in UTC, the next time strictly after the given one', async () => {
    const weekdaysAtNine = await loadCronSchedule({ expression: '0 9 * * 1-5', timezone: 'UTC' });

    expect(iso(weekdaysAtNine.nextAfter(at('2026-11-10T08:00:00Z')))).toBe('2026-11-10T09:00:00.000Z');
    expect(iso(weekdaysAtNine.nextAfter(at('2026-11-10T09:00:00Z')))).toBe('2026-11-11T09:00:00.000Z');
    expect(iso(weekdaysAtNine.nextAfter(at('2026-11-13T09:00:00.500Z')))).toBe('2026-11-16T09:00:00.000Z');
  });

  it('reads six fields with seconds first', async () => {
    const everyTwoSeconds = await loadCronSchedule({ expression: '*/2 * * * * *', timezone: 'UTC' });

    expect(timesAfter(everyTwoSeconds, '2026-11-10T08:00:00.300Z', 3)).toEqual([
      '2026-11-10T08:00:02.000Z',
      '2026-11-10T08:00:04.000Z',
      '2026-11-10T08:00:06.000Z',
    ]);
  });

  it('reads lists, ranges and steps', async () => {
    const schedule = await loadCronSchedule({ expression: '0,30 8-10/2 * * *', timezone: 'UTC' });

    expect(timesAfter(schedule, '2026-11-10T00:00:00Z', 5)).toEqual([
      '2026-11-10T08:00:00.000Z',
      '2026-11-10T08:30:00.000Z',
      '2026-11-10T10:00:00.000Z',
      '2026-11-10T10:30:00.000Z',
      '2026-11-11T08:00:00.000Z',
    ]);
  });

  it('reads month and day names, and nicknames', async () => {
    const named = await loadCronSchedule({ expression: '0 9 * JAN-MAR MON,FRI', timezone: 'UTC' });
    const daily = await loadCronSchedule({ expression: '@daily', timezone: 'UTC' });

    expect(timesAfter(named, '2026-11-10T00:00:00Z', 2)).toEqual([
      '2027-01-01T09:00:00.000Z',
      '2027-01-04T09:00:00.000Z',
    ]);
    expect(iso(daily.nextAfter(at('2026-11-10T08:00:00Z')))).toBe('2026-11-11T00:00:00.000Z');
  });

  it('runs on the day of the month or the day of the week when both are set', async () => {
    const thirteenthOrFriday = await loadCronSchedule({ expression: '0 0 13 * FRI', timezone: 'UTC' });

    expect(timesAfter(thirteenthOrFriday, '2026-11-10T00:00:00Z', 4)).toEqual([
      '2026-11-13T00:00:00.000Z',
      '2026-11-20T00:00:00.000Z',
      '2026-11-27T00:00:00.000Z',
      '2026-12-04T00:00:00.000Z',
    ]);
  });

  it('reads the expression in its time zone, across the change of offset', async () => {
    const nineInBerlin = await loadCronSchedule({ expression: '0 9 * * *', timezone: 'Europe/Berlin' });

    expect(iso(nineInBerlin.nextAfter(at('2026-11-10T00:00:00Z')))).toBe('2026-11-10T08:00:00.000Z');
    expect(iso(nineInBerlin.nextAfter(at('2027-07-01T00:00:00Z')))).toBe('2027-07-01T07:00:00.000Z');
  });

  it('runs a time the clocks skip (spring forward) once, when they resume', async () => {
    const halfPastTwo = await loadCronSchedule({ expression: '30 2 * * *', timezone: 'Europe/Berlin' });

    expect(timesAfter(halfPastTwo, '2027-03-27T00:00:00Z', 3)).toEqual([
      '2027-03-27T01:30:00.000Z',
      '2027-03-28T01:00:00.000Z',
      '2027-03-29T00:30:00.000Z',
    ]);
  });

  it('runs a time the clocks repeat (fall back) once, the first time', async () => {
    const halfPastTwo = await loadCronSchedule({ expression: '30 2 * * *', timezone: 'Europe/Berlin' });

    expect(timesAfter(halfPastTwo, '2027-10-30T00:00:00Z', 3)).toEqual([
      '2027-10-30T00:30:00.000Z',
      '2027-10-31T00:30:00.000Z',
      '2027-11-01T01:30:00.000Z',
    ]);
  });

  it('keeps a step running through both hours of a repeated hour', async () => {
    const everyHalfHour = await loadCronSchedule({ expression: '*/30 * * * *', timezone: 'Europe/Berlin' });

    expect(timesAfter(everyHalfHour, '2027-10-30T23:40:00Z', 6)).toEqual([
      '2027-10-31T00:00:00.000Z',
      '2027-10-31T00:30:00.000Z',
      '2027-10-31T01:00:00.000Z',
      '2027-10-31T01:30:00.000Z',
      '2027-10-31T02:00:00.000Z',
      '2027-10-31T02:30:00.000Z',
    ]);
  });

  it('has no time left past the year 9999', async () => {
    const everyMinute = await loadCronSchedule({ expression: '* * * * *', timezone: 'UTC' });

    expect(everyMinute.nextAfter(at('9999-12-31T23:59:30Z'))).toBe(Number.POSITIVE_INFINITY);
  });

  it.each([
    ['every day', "invalid configuration format ('every day'), exactly five, six, or seven space separated parts"],
    ['61 * * * *', 'Invalid value for minute: 61'],
    ['* * * *', "invalid configuration format ('* * * *'), exactly five, six, or seven space separated parts"],
    ['0 0 0 1 1 * 2030', "mode '5-or-6-parts' requires exactly 5 or 6 parts"],
    ['2030-01-01T00:00:00', 'a date is not a cron expression'],
    ['0 0 30 2 *', 'it never matches a date'],
  ])('refuses %p with the reason', async (expression, reason) => {
    const message = await reasonOf(expression);

    expect(message).toContain(reason);
    expect(message).not.toMatch(/^Cron/);
  });

  it('refuses a time zone the runtime does not know', async () => {
    expect(await reasonOf('0 9 * * *', 'Mars/Olympus')).toBe('"Mars/Olympus" is not an IANA time zone');
  });

  it('explains a failure that is not an Error', async () => {
    jest.resetModules();
    jest.doMock('croner', () => ({
      Cron: jest.fn(() => {
        throw 'out of memory';
      }),
    }));
    try {
      const isolated: typeof import('../cron-schedule') = require('../cron-schedule');
      await expect(isolated.loadCronSchedule({ expression: '* * * * *', timezone: 'UTC' })).rejects.toThrow(
        'out of memory',
      );
    } finally {
      jest.dontMock('croner');
      jest.resetModules();
    }
  });
});

describe('takeDueRun', () => {
  const START = at('2026-11-10T08:59:30Z');
  let storage: RootStorage;
  let everyMinute: CronSchedule;

  beforeEach(async () => {
    jest.useFakeTimers({ now: START });
    storage = createMemoryStorage();
    await storage.connect();
    everyMinute = await loadCronSchedule({ expression: '* * * * *', timezone: 'UTC' });
  });

  afterEach(async () => {
    await storage.disconnect();
    jest.useRealTimers();
  });

  it('records when the schedule was first seen, and takes no run for it', async () => {
    expect(await takeDueRun(everyMinute, storage, KEY)).toBe(false);

    expect(await storage.get(KEY)).toBe(String(START));
    expect(await storage.ttl(KEY)).toBe(-1);
  });

  it('takes nothing before the next scheduled time', async () => {
    await takeDueRun(everyMinute, storage, KEY);
    jest.setSystemTime(START + 29_999);

    expect(await takeDueRun(everyMinute, storage, KEY)).toBe(false);
    expect(await storage.get(KEY)).toBe(String(START));
  });

  it('takes a scheduled time once it has come, and not again', async () => {
    await takeDueRun(everyMinute, storage, KEY);
    jest.setSystemTime(START + 30_000);

    expect(await takeDueRun(everyMinute, storage, KEY)).toBe(true);
    expect(await storage.get(KEY)).toBe(String(START + 30_000));
    expect(await takeDueRun(everyMinute, storage, KEY)).toBe(false);
  });

  it('takes the scheduled times that passed while nothing ran as one run', async () => {
    await takeDueRun(everyMinute, storage, KEY);
    jest.setSystemTime(START + 10 * 60_000);

    expect(await takeDueRun(everyMinute, storage, KEY)).toBe(true);
    expect(await takeDueRun(everyMinute, storage, KEY)).toBe(false);
  });

  it('gives a scheduled time to one of two processes that take it at once', async () => {
    await takeDueRun(everyMinute, storage, KEY);
    jest.setSystemTime(START + 30_000);

    const taken = await Promise.all([takeDueRun(everyMinute, storage, KEY), takeDueRun(everyMinute, storage, KEY)]);

    expect(taken.filter(Boolean)).toHaveLength(1);
  });

  it('takes nothing while the recorded time is ahead of this clock', async () => {
    await storage.set(KEY, String(START + 5 * 60_000));
    jest.setSystemTime(START + 4 * 60_000);

    expect(await takeDueRun(everyMinute, storage, KEY)).toBe(false);
    expect(await storage.get(KEY)).toBe(String(START + 5 * 60_000));
  });

  it('starts over from now when the record is not a time', async () => {
    await storage.set(KEY, 'a-holder-id', { ttlSeconds: 60 });

    expect(await takeDueRun(everyMinute, storage, KEY)).toBe(false);
    expect(await storage.get(KEY)).toBe(String(START));
    expect(await storage.ttl(KEY)).toBe(-1);
  });
});
