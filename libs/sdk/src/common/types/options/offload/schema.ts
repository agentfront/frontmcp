import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';

export interface OffloadOptionsInterface {
  /**
   * Most worker threads that run `this.offload()` calls and `worker: true` reads at once, per scope.
   * Calls past it wait for a free worker.
   * @default the machine's available parallelism minus one, between 1 and 4
   */
  maxWorkers?: number;

  /**
   * How long a worker may sit idle before it is stopped. Workers start on the first call that needs one.
   * @default 30000
   */
  idleTimeoutMs?: number;

  /**
   * How long offloaded work may run in its worker, for a call that gives no `budgetMs`. Past it the worker is
   * terminated and the call rejects with `OffloadBudgetExceededError`.
   * @default 30000
   */
  budgetMs?: number;

  /**
   * The environment variables copied into each worker. No other variable of the server's `process.env` reaches it.
   * @default ['NODE_ENV']
   */
  env?: string[];
}

function wholeMilliseconds(path: string) {
  return z
    .number({ message: `offload.${path} must be a number of milliseconds` })
    .int(`offload.${path} must be a whole number of milliseconds`)
    .positive(`offload.${path} must be greater than 0`);
}

export const offloadOptionsSchema = z
  .object({
    maxWorkers: z
      .number({ message: 'offload.maxWorkers must be a number' })
      .int('offload.maxWorkers must be a whole number')
      .positive('offload.maxWorkers must be at least 1')
      .optional(),
    idleTimeoutMs: wholeMilliseconds('idleTimeoutMs').optional(),
    budgetMs: wholeMilliseconds('budgetMs').optional(),
    env: z
      .array(z.string().min(1, 'offload.env entries must be variable names'), {
        message: 'offload.env must be a list of environment variable names',
      })
      .optional(),
  } satisfies RawZodShape<OffloadOptionsInterface>)
  .strict();

export type OffloadOptions = z.infer<typeof offloadOptionsSchema>;
export type OffloadOptionsInput = z.input<typeof offloadOptionsSchema>;
