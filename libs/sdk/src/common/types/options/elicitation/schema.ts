// common/types/options/elicitation/schema.ts
//
// Elicitation configuration schema for @FrontMcp decorator.
// Uses explicit interfaces from interfaces.ts for IDE autocomplete.

import { z } from 'zod';
import type { RawZodShape } from '../../common.types';
import type { ElicitationOptionsInterface } from './interfaces';
import { redisOptionsSchema } from '../redis';

// Re-export interface type for convenience
export type { ElicitationOptionsInterface };

// ============================================
// ELICITATION OPTIONS SCHEMA
// ============================================

/**
 * Zod schema for elicitation configuration.
 *
 * Validates and provides defaults for elicitation options.
 * See `ElicitationOptionsInterface` for full documentation.
 */
export const elicitationOptionsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  redis: redisOptionsSchema.optional(),
} satisfies RawZodShape<ElicitationOptionsInterface>);

// ============================================
// DEFAULT VALUES
// ============================================

/**
 * Default elicitation configuration values.
 *
 * Elicitation is disabled by default to avoid unnecessary
 * resource overhead for servers that don't use it.
 */
export const DEFAULT_ELICITATION_OPTIONS: Pick<Required<ElicitationOptionsInterface>, 'enabled'> = {
  enabled: false,
};

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Elicitation options type (with defaults applied).
 *
 * This is the type of elicitation config after Zod parsing,
 * with all defaults applied.
 */
export type ElicitationOptions = z.infer<typeof elicitationOptionsSchema>;

/**
 * Elicitation options input type (for user configuration).
 *
 * This is the type users should use when configuring elicitation
 * options in the `@FrontMcp` decorator.
 */
export type ElicitationOptionsInput = z.input<typeof elicitationOptionsSchema>;
