// options/app-auth.schema.ts
// App-level auth options with standalone option

import { z } from 'zod';
import { RawZodShape } from '../common/zod-utils';
import { publicAuthOptionsSchema } from './public.schema';
import { transparentAuthOptionsSchema } from './transparent.schema';
import { orchestratedLocalSchema, orchestratedRemoteSchema } from './orchestrated.schema';

// ============================================
// STANDALONE OPTION
// ============================================

type StandaloneOption = {
  /**
   * If the provider is standalone, it will register an OAuth service provider
   * on app's entry path. If not standalone, it will be registered as a child
   * provider under the root provider.
   * @default false
   */
  standalone?: boolean;

  /**
   * If the provider should be excluded from the parent provider's discovery.
   * Used for standalone providers.
   * @default false
   */
  excludeFromParent?: boolean;
};

const standaloneOptionSchema = {
  standalone: z.boolean().optional(),
  excludeFromParent: z.boolean().optional(),
} satisfies RawZodShape<StandaloneOption>;

// ============================================
// APP-LEVEL AUTH OPTIONS
// ============================================

export const appAuthOptionsSchema = z.union([
  publicAuthOptionsSchema.extend(standaloneOptionSchema),
  transparentAuthOptionsSchema.extend(standaloneOptionSchema),
  orchestratedLocalSchema.extend(standaloneOptionSchema),
  orchestratedRemoteSchema.extend(standaloneOptionSchema),
]);

// ============================================
// TYPE EXPORTS
// ============================================

export type AppAuthOptions = z.infer<typeof appAuthOptionsSchema>;
export type AppAuthOptionsInput = z.input<typeof appAuthOptionsSchema>;
