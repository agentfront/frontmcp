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
 * A run taken from a schedule's ledger. `scheduledAt` names it: a process that takes it again (after the one that took
 * it died before starting its run) gets the same `scheduledAt`.
 */
export interface CronClaim {
  /** The first scheduled time the run is for. */
  scheduledAt: number;
  /** When the schedule was taken for it, which the ledger records once the claim is settled. */
  takenAt: number;
  /** What the ledger holds for the claim, which `settleCronClaim()` replaces. */
  recorded: string;
}

/** The ledger: when the schedule was last taken, and the scheduled time whose run is still owed, if any. */
interface CronLedger {
  takenAt: number;
  owed?: number;
}

/**
 * A ledger value: `<takenAt>`, or `<takenAt> <scheduledAt> <claimedAt>` while that scheduled time's run is owed, the
 * last field telling one claim of it from the next.
 */
function readLedger(recorded: string): CronLedger | undefined {
  const [takenAt, owed] = recorded.split(' ').map(Number);
  if (!Number.isFinite(takenAt)) return undefined;
  return owed !== undefined && Number.isFinite(owed) ? { takenAt, owed } : { takenAt };
}

/**
 * Take the scheduled times that passed since the last take, as one run. The store keeps the time of the last take
 * under `key` and replaces it only while it still holds what this process read, so the processes that share the store
 * take each scheduled time once. The first take ever only records when the schedule was first seen.
 *
 * With `owedUntilSettled`, the ledger keeps the scheduled time the run is for until `settleCronClaim()`: a process that
 * finds it there (the one that took it died before starting the run) takes that same run again, and the times missed
 * meanwhile come due at its next check.
 */
export async function claimDueRun(
  schedule: CronSchedule,
  storage: CronLedgerStorage,
  key: string,
  owedUntilSettled = false,
): Promise<CronClaim | undefined> {
  const now = Date.now();
  const recorded = await storage.get(key);
  const ledger = recorded === null ? undefined : readLedger(recorded);
  if (recorded === null || ledger === undefined) {
    await storage.set(key, String(now));
    return undefined;
  }
  const scheduledAt = ledger.owed ?? schedule.nextAfter(ledger.takenAt);
  if (ledger.owed === undefined && scheduledAt > now) return undefined;
  const takenAt = ledger.owed === undefined ? now : ledger.takenAt;
  const claimed = owedUntilSettled ? `${takenAt} ${scheduledAt} ${now}` : String(takenAt);
  if (!(await storage.setIfEquals(key, recorded, claimed))) return undefined;
  return { scheduledAt, takenAt, recorded: claimed };
}

/** Record that the claimed run started, unless another process took the claim over meanwhile. */
export async function settleCronClaim(storage: CronLedgerStorage, key: string, claim: CronClaim): Promise<void> {
  await storage.setIfEquals(key, claim.recorded, String(claim.takenAt));
}
