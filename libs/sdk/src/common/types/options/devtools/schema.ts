import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';

export interface DevtoolsOptionsInterface {
  /**
   * Add `_meta['frontmcp/trace']` to tool, resource and prompt answers: the hooks that ran for the call, in order,
   * each as `{ owner, method, stage, type, ms, outcome }`, never with their arguments or answers. To an answer for
   * which no hook ran, it adds no key.
   * @default true when NODE_ENV is 'development', false otherwise
   */
  hookTrace?: boolean;
}

export const devtoolsOptionsSchema = z
  .object({
    hookTrace: z.boolean({ message: 'devtools.hookTrace must be true or false' }).optional(),
  } satisfies RawZodShape<DevtoolsOptionsInterface>)
  .strict();

export type DevtoolsOptions = z.infer<typeof devtoolsOptionsSchema>;
export type DevtoolsOptionsInput = z.input<typeof devtoolsOptionsSchema>;
