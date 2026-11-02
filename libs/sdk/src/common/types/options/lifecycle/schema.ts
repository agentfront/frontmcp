import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';

export interface LifecycleOptionsInterface {
  /**
   * How long each provider's `onShutdown()` may run before shutdown logs a warning and moves on.
   * @default 3000
   */
  shutdownHookTimeoutMs?: number;
}

export const lifecycleOptionsSchema = z
  .object({
    shutdownHookTimeoutMs: z
      .number({ message: 'lifecycle.shutdownHookTimeoutMs must be a number of milliseconds' })
      .int('lifecycle.shutdownHookTimeoutMs must be a whole number of milliseconds')
      .positive('lifecycle.shutdownHookTimeoutMs must be greater than 0')
      .optional(),
  } satisfies RawZodShape<LifecycleOptionsInterface>)
  .strict();

export type LifecycleOptions = z.infer<typeof lifecycleOptionsSchema>;
export type LifecycleOptionsInput = z.input<typeof lifecycleOptionsSchema>;
