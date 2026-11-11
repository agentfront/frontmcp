import { type NamespacedStorage } from '@frontmcp/utils';

import { type DutyCron } from '../common/metadata/duty.metadata';
import { isIanaTimeZone } from '../common/utils/time-zone.utils';

/** What a schedule asks of croner's `Cron`. */
interface CronTimes {
  nextRun(after: Date): Date | null;
}

/** The store operations that record which scheduled times were taken; each store runs them atomically. */
export type CronLedgerStorage = Pick<NamespacedStorage, 'get' | 'set' | 'setIfEquals'>;

/** The times of a cron expression in its time zone, as epoch milliseconds. */
export class CronSchedule {
  constructor(
    readonly expression: string,
    readonly timezone: string,
    private readonly cron: CronTimes,
  ) {}

  /** The first scheduled time after `afterMs`; `Infinity` once the calendar has none left (past the year 9999). */
  nextAfter(afterMs: number): number {
    return this.cron.nextRun(new Date(afterMs))?.getTime() ?? Number.POSITIVE_INFINITY;
  }
}

/**
 * Read a cron expression of 5 fields, or 6 with seconds first. croner loads here, so only once a duty or a workflow
 * declares a cron.
 *
 * @throws Error whose message is the reason the expression or its time zone can't be read
 */
export async function loadCronSchedule({ expression, timezone }: DutyCron): Promise<CronSchedule> {
  if (!isIanaTimeZone(timezone)) throw new Error(`"${timezone}" is not an IANA time zone`);
  const { Cron } = await import('croner');
  const cron = readOrExplain(() => new Cron(expression, { timezone, mode: '5-or-6-parts' }));
  if (cron.getPattern() === undefined) throw new Error('a date is not a cron expression');
  if (cron.nextRun() === null) throw new Error('it never matches a date');
  return new CronSchedule(expression, timezone, cron);
}

/** croner's failure as its message alone, without its class prefix (`CronPattern: `). */
function readOrExplain<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Cron\w*: /, ''), { cause: error });
  }
}

/**
 * Take the scheduled times that passed since the last take, as one run. The store keeps the time of the last take
 * under `key` and replaces it only while it still holds what this process read, so the processes that share the store
 * take each scheduled time once. The first take ever only records when the schedule was first seen.
 */
export async function takeDueRun(schedule: CronSchedule, storage: CronLedgerStorage, key: string): Promise<boolean> {
  const now = Date.now();
  const recorded = await storage.get(key);
  const takenUntil = Number(recorded ?? Number.NaN);
  if (recorded === null || !Number.isFinite(takenUntil)) {
    await storage.set(key, String(now));
    return false;
  }
  if (schedule.nextAfter(takenUntil) > now) return false;
  return storage.setIfEquals(key, recorded, String(now));
}
