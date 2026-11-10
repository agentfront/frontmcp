import { z } from '@frontmcp/lazy-zod';

/**
 * Where a worker runs: `'process'` in every server process; otherwise in one process at a time, the one that holds
 * the worker's lease, among those of a machine, of a project root (the nearest package.json), or of all the machines
 * that share the server's Redis (`'cluster'`, which needs a top-level `redis`).
 */
export type WorkerScope = 'process' | 'machine' | 'workspace' | 'cluster';

/** How long the server waits before it runs a worker again after `run()` returned or threw. */
export interface WorkerRestartOptions {
  /** The wait before the first restart. @default 1000 */
  minDelayMs?: number;
  /** The longest wait. A run that lasted longer than it starts the waits over at `minDelayMs`. @default 60000 */
  maxDelayMs?: number;
  /** How many times longer each wait is than the one before. @default 2 */
  factor?: number;
}

export interface WorkerMetadata {
  /** The worker's name in logs, in its health check and in its lease. @default the class name */
  name?: string;
  scope: WorkerScope;
  /** `false` runs `run()` once and never again. @default restarts with the default waits */
  restart?: false | WorkerRestartOptions;
  /**
   * How long the lease outlives a holder that stopped renewing it (killed, paused, hung), so how soon another process
   * takes the worker over. Renewed every third of it. Not for `scope: 'process'`, which has no lease. @default 15000
   */
  leaseMs?: number;
}

export interface ResolvedWorkerRestart {
  minDelayMs: number;
  maxDelayMs: number;
  factor: number;
}

export interface ResolvedWorkerMetadata {
  name: string;
  scope: WorkerScope;
  restart: false | ResolvedWorkerRestart;
  leaseMs: number;
}

const MAX_TIMER_MS = 2_147_483_647;
const DEFAULT_LEASE_MS = 15_000;
const RESTART_FORMAT = 'restart must be false or { minDelayMs, maxDelayMs, factor }';

function wholeMilliseconds(field: string) {
  return z
    .number({ message: `${field} must be a number of milliseconds` })
    .int(`${field} must be a whole number of milliseconds`)
    .max(MAX_TIMER_MS, `${field} must be at most ${MAX_TIMER_MS} ms (about 24.8 days)`);
}

const workerRestartSchema = z
  .object(
    {
      minDelayMs: wholeMilliseconds('restart.minDelayMs')
        .min(1, 'restart.minDelayMs must be at least 1')
        .optional()
        .default(1_000),
      maxDelayMs: wholeMilliseconds('restart.maxDelayMs')
        .min(1, 'restart.maxDelayMs must be at least 1')
        .optional()
        .default(60_000),
      factor: z
        .number({ message: 'restart.factor must be a number' })
        .min(1, 'restart.factor must be at least 1')
        .optional()
        .default(2),
    },
    { error: (issue) => (issue.code === 'invalid_type' ? RESTART_FORMAT : undefined) },
  )
  .strict()
  .refine(({ minDelayMs, maxDelayMs }) => minDelayMs <= maxDelayMs, {
    message: 'restart.minDelayMs must not be greater than restart.maxDelayMs',
    path: ['minDelayMs'],
  });

export const workerMetadataSchema = z
  .object({
    name: z.string({ message: 'name must be a string' }).min(1, 'name must not be empty').optional(),
    scope: z.enum(['process', 'machine', 'workspace', 'cluster'], {
      message: "scope must be 'process', 'machine', 'workspace' or 'cluster'",
    }),
    restart: z.unknown().optional(),
    leaseMs: wholeMilliseconds('leaseMs')
      .min(1_000, 'leaseMs must be at least 1000 (stores keep a TTL in whole seconds)')
      .optional(),
  })
  .strict()
  .transform(({ name, scope, restart, leaseMs }, context) => {
    if (scope === 'process' && leaseMs !== undefined) {
      const message = "leaseMs applies to a leased scope; a 'process' worker has no lease";
      context.addIssue({ code: 'custom', path: ['leaseMs'], message });
      return z.NEVER;
    }
    const common = { name, scope, leaseMs: leaseMs ?? DEFAULT_LEASE_MS };
    if (restart === false) return { ...common, restart: false as const };
    const waits = workerRestartSchema.safeParse(restart === undefined ? {} : restart);
    if (waits.success) return { ...common, restart: waits.data };
    for (const { path, message } of waits.error.issues) {
      context.addIssue({ code: 'custom', path: ['restart', ...path], message });
    }
    return z.NEVER;
  });
