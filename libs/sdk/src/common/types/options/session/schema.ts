// common/types/options/session/schema.ts
// Zod schema for session configuration

import { z } from '@frontmcp/lazy-zod';

import { aiPlatformTypeSchema } from '../../auth/session.types';
import { type RawZodShape } from '../../common.types';
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
 *
 * @deprecated Nothing reads these options (see {@link SessionOptionsInterface}); removed in the next major.
 */
export const sessionOptionsSchema = z.object({
  sessionMode: z
    .union([z.literal('stateful'), z.literal('stateless'), z.function()])
    .optional()
    .default('stateless'),
  platformDetection: platformDetectionConfigSchema.optional(),
} satisfies RawZodShape<SessionOptionsInterface>);

/**
 * The pre-1.0 `@FrontMcp({ session })` option as a server config accepts it: no defaults, and nothing
 * reads it. It is kept so a config that still sets it gets a startup warning instead of losing the
 * option silently. Removed in the next major.
 *
 * @deprecated Use `transport.protocol` and `transport.platformDetection`.
 */
export const legacySessionOptionsSchema = z.object({
  sessionMode: z.union([z.literal('stateful'), z.literal('stateless'), z.function()]).optional(),
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
