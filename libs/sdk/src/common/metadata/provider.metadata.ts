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
 *
 * - GLOBAL: Singleton, shared across all requests
 * - CONTEXT: Per-context instance (combines session + request data)
 * - SESSION: deprecated Use CONTEXT instead
 * - REQUEST: deprecated Use CONTEXT instead
 */
export enum ProviderScope {
  /** Singleton, shared across all requests */
  GLOBAL = 'global',
  /** Per-context instance (unified session + request scope) */
  CONTEXT = 'context',
  /**
   * @deprecated Use CONTEXT instead. Maps to CONTEXT internally.
   */
  SESSION = 'session',
  /**
   * @deprecated Use CONTEXT instead. Maps to CONTEXT internally.
   */
  REQUEST = 'request',
}

export const frontMcpProviderMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    scope: z.nativeEnum(ProviderScope).optional().default(ProviderScope.GLOBAL),
  } satisfies RawZodShape<ProviderMetadata>)
  .passthrough();
