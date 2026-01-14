// common/types/options/auth/schema.ts
// Unified auth options schema combining all modes

import { z } from 'zod';
import { publicAuthOptionsSchema } from './public.schema';
import { transparentAuthOptionsSchema } from './transparent.schema';
import { orchestratedLocalSchema, orchestratedRemoteSchema } from './orchestrated.schema';

// ============================================
// UNIFIED AUTH OPTIONS
// ============================================

/**
 * Main auth options schema - discriminated by 'mode'
 *
 * Uses z.union because we have nested discriminators (orchestrated has 'type')
 */
export const authOptionsSchema = z.union([
  publicAuthOptionsSchema,
  transparentAuthOptionsSchema,
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
]);

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Auth options (output type with defaults applied)
 * Use this type when working with parsed/validated options
 */
export type AuthOptions = z.infer<typeof authOptionsSchema>;

/**
 * Auth options input (input type for user configuration)
 * Use this type for the @frontmcp configuration
 */
export type AuthOptionsInput = z.input<typeof authOptionsSchema>;

/**
 * Authentication mode
 */
export type AuthMode = 'public' | 'transparent' | 'orchestrated';
