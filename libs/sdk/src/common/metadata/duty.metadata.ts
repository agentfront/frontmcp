import { z } from '@frontmcp/lazy-zod';

/** Where one process at a time runs a duty: one per machine, or one per project root (the nearest package.json). */
export type DutyScope = 'machine' | 'workspace';

export interface DutyMetadata {
  /** The lease's name within the server. Set it when a build renames classes. @default the class name */
  name?: string;
  /** How often the duty runs: milliseconds, or a duration such as `'500ms'`, `'30s'`, `'5m'`, `'1h'` or `'1d'`. */
  every: number | string;
  scope: DutyScope;
  /**
   * How long the lease outlives a holder that stopped renewing it (killed, paused, hung), so how soon another process
   * takes the duty over. Renewed every third of it. @default three intervals, between 3000 and 60000
   */
  leaseMs?: number;
}

export interface ResolvedDutyMetadata {
  name: string;
  everyMs: number;
  scope: DutyScope;
  leaseMs: number;
}

const DUTY_METADATA = Symbol.for('frontmcp:duty');
const MAX_TIMER_MS = 2_147_483_647;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const EVERY_FORMAT = 'every must be milliseconds or a duration such as "30s", "5m", "1h"';

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
      .pipe(wholeMilliseconds('every').positive('every must be greater than 0')),
    scope: z.enum(['machine', 'workspace'], { message: "scope must be 'machine' or 'workspace'" }),
    leaseMs: wholeMilliseconds('leaseMs')
      .min(1_000, 'leaseMs must be at least 1000 (stores keep a TTL in whole seconds)')
      .optional(),
  })
  .strict();

/** @internal Records what `@Duty` resolved on the class. */
export function defineDutyMetadata(target: object, metadata: ResolvedDutyMetadata): void {
  Reflect.defineMetadata(DUTY_METADATA, metadata, target);
}

/** The `@Duty` metadata of an instance's class, when it has some. */
export function dutyMetadataOf(value: unknown): ResolvedDutyMetadata | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.getMetadata(DUTY_METADATA, value.constructor);
}
