import { z } from 'zod';
import { RawZodShape } from '../types';

/**
 * Declarative metadata describing what a FrontMcpAdapter contributes at app scope.
 */
export interface AdapterMetadata {
  id?: string;
  name: string;
  description?: string;
}

export const frontMcpAdapterMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
  } satisfies RawZodShape<AdapterMetadata>)
  .passthrough();
