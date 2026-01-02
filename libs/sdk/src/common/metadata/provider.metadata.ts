import { z } from 'zod';
import { ProviderScope, ProviderMetadata } from '@frontmcp/di';
import { RawZodShape } from '../types';

/**
 * FrontMCP-specific schema for provider metadata validation.
 * Uses the base ProviderMetadata interface from DI.
 */
export const frontMcpProviderMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    scope: z.nativeEnum(ProviderScope).optional().default(ProviderScope.GLOBAL),
  } satisfies RawZodShape<ProviderMetadata>)
  .passthrough();
