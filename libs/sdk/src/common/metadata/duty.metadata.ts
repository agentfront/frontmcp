import { z } from '@frontmcp/lazy-zod';

import { isIanaTimeZone } from '../utils/time-zone.utils';

/**
 * A lease the app names among the processes of a machine: those whose `key` is the same share one lease, whatever folder
 * they run from. A function is called each time the duty starts, in each process.
 */
export interface DutyKeyedScope {
  key: string | (() => string | Promise<string>);
}

/**
 * Where one process at a time runs a duty: one per machine, one per project root (the nearest package.json), one
 * among all the machines that share the server's Redis (`'cluster'`, which needs a top-level `redis`), or one per key
 * the app chooses among the processes of a machine (`{ key }`).
 */
export type DutyScope = 'machine' | 'workspace' | 'cluster' | DutyKeyedScope;

/**
 * Whether this process should run the duty: `true` takes the lease over from a process that is not preferred. A
 * function is called each time the duty starts, in each process.
 */
export type DutyPreference = boolean | (() => boolean | Promise<boolean>);

interface DutyCommonMetadata {
  /** The lease's name within the server, for one class. Set it when a build renames classes. @default the class name */
  name?: string;
  scope: DutyScope;
  /**
   * Whether this process takes the duty over from one that is not preferred: that one stops at its next lease check
   * (every third of `leaseMs`), once its run in flight ended, and releases the lease; while a preferred process holds
   * it, or contends for it, the others don't take it. Two preferred processes contend as any two do. @default false
   */
  prefer?: DutyPreference;
  /**
   * How long the lease outlives a holder that stopped renewing it (killed, paused, hung), so how soon another process
   * takes the duty over. Renewed every third of it. @default three intervals, between 3000 and 60000; 60000 with `cron`
   */
  leaseMs?: number;
}

interface DutyIntervalMetadata extends DutyCommonMetadata {
  /** How often the duty runs: milliseconds, or a duration such as `'500ms'`, `'30s'`, `'5m'`, `'1h'` or `'1d'`. */
  every: number | string;
  cron?: never;
  timezone?: never;
}

interface DutyCronMetadata extends DutyCommonMetadata {
  /**
   * When the duty runs, as a cron expression: `minute hour day-of-month month day-of-week` (`'0 9 * * 1-5'`), with
   * seconds as an optional first field. Lists, ranges, steps, month and day names and `@daily`-style nicknames work.
   */
  cron: string;
  /** The IANA time zone the expression is read in, such as `'Europe/Berlin'`. @default 'UTC' */
  timezone?: string;
  every?: never;
}

/** A duty runs either every interval (`every`) or at the times of a cron expression (`cron`). */
export type DutyMetadata = DutyIntervalMetadata | DutyCronMetadata;

/** A cron expression and the time zone it is read in. */
export interface DutyCron {
  expression: string;
  timezone: string;
}

interface ResolvedDutyCommon {
  name: string;
  scope: DutyScope;
  leaseMs: number;
  prefer?: DutyPreference;
}

export type ResolvedDutyMetadata = ResolvedDutyCommon &
  ({ everyMs: number; cron?: undefined } | { cron: DutyCron; everyMs?: undefined });

const MAX_TIMER_MS = 2_147_483_647;
const CRON_LEASE_MS = 60_000;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const EVERY_FORMAT = 'every must be milliseconds or a duration such as "30s", "5m", "1h"';
const CRON_FORMAT = 'cron must be a cron expression such as "0 9 * * 1-5"';
const TIMEZONE_FORMAT = 'timezone must be an IANA time zone such as "Europe/Berlin"';
const SCOPE_FORMAT = "scope must be 'machine', 'workspace' or 'cluster', or { key } for a lease the app names";
const KEY_FORMAT = 'scope.key must be a string of 1 to 1024 characters, or a function that returns one';
const PREFER_FORMAT = 'prefer must be true, false, or a function that returns one';

function toMilliseconds(every: number | string): number {
  if (typeof every === 'number') return every;
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(every.trim());
  return match ? Number(match[1]) * UNIT_MS[match[2]] : Number.NaN;
}

function wholeMilliseconds(field: string) {
  return z
    .number({ message: field === 'every' ? EVERY_FORMAT : `${field} must be a number of milliseconds` })
    .int(`${field} must be a whole number of milliseconds`)
    .max(MAX_TIMER_MS, `${field} must be at most ${MAX_TIMER_MS} ms (about 24.8 days)`);
}

export const dutyMetadataSchema = z
  .object({
    name: z.string({ message: 'name must be a string' }).min(1, 'name must not be empty').optional(),
    every: z
      .union([z.number(), z.string()], { message: EVERY_FORMAT })
      .transform(toMilliseconds)
      .pipe(wholeMilliseconds('every').positive('every must be greater than 0'))
      .optional(),
    cron: z.string({ message: CRON_FORMAT }).trim().min(1, CRON_FORMAT).optional(),
    timezone: z.string({ message: TIMEZONE_FORMAT }).refine(isIanaTimeZone, TIMEZONE_FORMAT).optional(),
    scope: z.union(
      [
        z.enum(['machine', 'workspace', 'cluster']),
        z
          .object({
            key: z.union([
              z.string().trim().min(1, KEY_FORMAT).max(1_024, KEY_FORMAT),
              z.custom<() => string | Promise<string>>((value) => typeof value === 'function', { message: KEY_FORMAT }),
            ]),
          })
          .strict(),
      ],
      { message: SCOPE_FORMAT },
    ),
    prefer: z
      .union(
        [
          z.boolean(),
          z.custom<() => boolean | Promise<boolean>>((value) => typeof value === 'function', {
            message: PREFER_FORMAT,
          }),
        ],
        { message: PREFER_FORMAT },
      )
      .optional(),
    leaseMs: wholeMilliseconds('leaseMs')
      .min(1_000, 'leaseMs must be at least 1000 (stores keep a TTL in whole seconds)')
      .optional(),
  })
  .strict()
  .transform(({ every, cron, timezone, name, scope, leaseMs, prefer }, context) => {
    const refuse = (field: string, message: string) => {
      context.addIssue({ code: 'custom', path: [field], message });
      return z.NEVER;
    };
    if (every !== undefined && cron !== undefined) return refuse('cron', 'set either every or cron, not both');
    if (cron !== undefined) {
      return {
        name,
        scope,
        leaseMs: leaseMs ?? CRON_LEASE_MS,
        cron: { expression: cron, timezone: timezone ?? 'UTC' },
        ...(prefer === undefined ? {} : { prefer }),
      };
    }
    if (timezone !== undefined) return refuse('timezone', 'timezone applies to cron; a duty with every has none');
    if (every === undefined) return refuse('every', 'a duty needs every (an interval) or cron (a cron expression)');
    const intervalLeaseMs = leaseMs ?? Math.min(Math.max(3 * every, 3_000), 60_000);
    return { name, scope, leaseMs: intervalLeaseMs, everyMs: every, ...(prefer === undefined ? {} : { prefer }) };
  });
