// common/types/options/session/schema.ts
// Zod schema for session configuration

import { z } from 'zod';
import { RawZodShape } from '../../common.types';
import { aiPlatformTypeSchema } from '../../auth/session.types';
import type { SessionOptionsInterface } from './interfaces';

/**
 * Zod schema for platform mapping entry.
 * Note: RegExp cannot be validated by zod, so we use passthrough for pattern.
 */
export const platformMappingEntrySchema = z.object({
  pattern: z.union([z.string(), z.instanceof(RegExp)]),
  platform: aiPlatformTypeSchema,
});

/**
 * Zod schema for platform detection configuration.
 */
export const platformDetectionConfigSchema = z.object({
  mappings: z.array(platformMappingEntrySchema).optional(),
  customOnly: z.boolean().optional().default(false),
});

/**
 * Session options Zod schema.
 */
export const sessionOptionsSchema = z.object({
  sessionMode: z
    .union([z.literal('stateful'), z.literal('stateless'), z.function()])
    .optional()
    .default('stateless'),
  platformDetection: platformDetectionConfigSchema.optional(),
} satisfies RawZodShape<SessionOptionsInterface>);

/**
 * Platform mapping entry type.
 */
export type PlatformMappingEntry = z.infer<typeof platformMappingEntrySchema>;

/**
 * Platform detection config type.
 */
export type PlatformDetectionConfig = z.infer<typeof platformDetectionConfigSchema>;

/**
 * Session options type (with defaults applied).
 */
export type SessionOptions = z.infer<typeof sessionOptionsSchema>;

/**
 * Session options input type (for user configuration).
 */
export type SessionOptionsInput = z.input<typeof sessionOptionsSchema>;
