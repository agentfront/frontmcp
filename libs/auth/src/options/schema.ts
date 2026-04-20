// options/schema.ts
// Unified auth options schema combining all modes

import { z } from '@frontmcp/lazy-zod';

import type { AuthOptionsInterface } from './interfaces';
import { localAuthSchema, remoteAuthSchema } from './orchestrated.schema';
import { publicAuthOptionsSchema } from './public.schema';
import { transparentAuthOptionsSchema } from './transparent.schema';

// ============================================
// UNIFIED AUTH OPTIONS
// ============================================

export const authOptionsSchema = z.union([
  publicAuthOptionsSchema,
  transparentAuthOptionsSchema,
  localAuthSchema,
  remoteAuthSchema,
]);

// ============================================
// TYPE EXPORTS
// ============================================

export type AuthOptions = z.infer<typeof authOptionsSchema>;

/**
 * Auth options input type (for user configuration).
 * Uses explicit interface for better IDE autocomplete.
 */
export type AuthOptionsInput = AuthOptionsInterface;
export type AuthMode = 'public' | 'transparent' | 'local' | 'remote';
