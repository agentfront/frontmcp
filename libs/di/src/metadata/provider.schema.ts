/**
 * Zod schema for provider metadata validation.
 */

import { z } from 'zod';
import { ProviderScope, type ProviderMetadata } from './provider.metadata.js';

/**
 * Helper type for creating Zod schemas that match an interface.
 */
export type RawZodShape<T> = {
  [K in keyof T]-?: z.ZodType<T[K]>;
};

/**
 * Zod schema for validating provider metadata.
 *
 * @example
 * ```typescript
 * const metadata = providerMetadataSchema.parse({
 *   name: 'UserService',
 *   scope: 'global'
 * });
 * ```
 */
export const providerMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    scope: z.nativeEnum(ProviderScope).optional().default(ProviderScope.GLOBAL),
  } satisfies RawZodShape<ProviderMetadata>)
  .passthrough();

/**
 * Type inferred from the provider metadata schema.
 */
export type ValidatedProviderMetadata = z.infer<typeof providerMetadataSchema>;
