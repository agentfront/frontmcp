import { z } from 'zod';
import { RawZodShape } from '../types';

/**
 * Declarative metadata describing what a FrontMcpProvider contributes at app scope.
 */
export interface AuthProviderMetadata {
  id?: string;
  name: string;
  description?: string;
  scope?: AuthProviderScope;
}

/**
 * Provider lifetime scope semantics.
 */
export enum AuthProviderScope {
  GLOBAL = 'global',
  SESSION = 'session',
}

export const frontMcpAuthProviderMetadataSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  scope: z.nativeEnum(AuthProviderScope).optional().default(AuthProviderScope.GLOBAL),
} satisfies RawZodShape<AuthProviderMetadata>).passthrough();
