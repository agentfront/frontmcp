// options/schema.ts
// Unified auth options schema combining all modes

import { z } from 'zod';
import { publicAuthOptionsSchema } from './public.schema';
import { transparentAuthOptionsSchema } from './transparent.schema';
import { orchestratedLocalSchema, orchestratedRemoteSchema } from './orchestrated.schema';

// ============================================
// UNIFIED AUTH OPTIONS
// ============================================

export const authOptionsSchema = z.union([
  publicAuthOptionsSchema,
  transparentAuthOptionsSchema,
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
]);

// ============================================
// TYPE EXPORTS
// ============================================

export type AuthOptions = z.infer<typeof authOptionsSchema>;
export type AuthOptionsInput = z.input<typeof authOptionsSchema>;
export type AuthMode = 'public' | 'transparent' | 'orchestrated';
