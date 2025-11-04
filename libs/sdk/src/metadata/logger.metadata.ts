import { z } from 'zod';
import { RawZodShape } from '../types';

declare global {
  /**
   * Declarative metadata extends to an FrontMcpLogger decorator.
   */
  export interface ExtendFrontMcpLoggerMetadata {
  }
}

/**
 * Declarative metadata describing what a FrontMcpLogger contributes.
 */
export interface LogTransportMetadata extends ExtendFrontMcpLoggerMetadata {
  /**
   * Optional unique identifier for the logger.
   * If omitted, a consumer may derive an ID from the class or file name.
   */
  id?: string;

  /**
   * Human‑readable name of the logger, used in UIs, logs, and discovery.
   */
  name: string;

  /**
   * Short summary describing what the logger does and when to use it.
   */
  description?: string;
}


export const frontMcpLogTransportMetadataSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
} satisfies RawZodShape<LogTransportMetadata, ExtendFrontMcpLoggerMetadata>).passthrough();

