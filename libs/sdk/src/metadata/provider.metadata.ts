import { z } from 'zod';
import { RawZodShape } from '../types';


/**
 * Declarative metadata describing what a FrontMcpProvider contributes at app scope.
 */
export interface ProviderMetadata {
  id?: string;
  name: string;
  description?: string;
  scope?: ProviderScope;
}

/**
 * Provider lifetime scope semantics.
 */
export enum ProviderScope {
  GLOBAL = 'global',
  SESSION = 'session',
  REQUEST = 'request',
}

export const frontMcpProviderMetadataSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  scope: z.nativeEnum(ProviderScope).optional().default(ProviderScope.GLOBAL),
} satisfies RawZodShape<ProviderMetadata>).passthrough();

