// common/types/options/logging/schema.ts
// Zod schema for logging configuration

import { z } from 'zod';
import { annotatedFrontMcpLoggerSchema } from '../../../schemas';
import { RawZodShape } from '../../common.types';
import { LogLevel, LoggingOptionsInterface } from './interfaces';

/**
 * Logging options Zod schema.
 */
export const loggingOptionsSchema = z.object({
  level: z.nativeEnum(LogLevel).optional().default(LogLevel.Info),
  prefix: z.string().optional(),
  enableConsole: z.boolean().optional().default(true),
  transports: z.array(annotatedFrontMcpLoggerSchema).optional().default([]),
} satisfies RawZodShape<LoggingOptionsInterface>);

/**
 * Logging configuration type (with defaults applied, excluding transports).
 */
export type LoggingConfigType = Omit<z.infer<typeof loggingOptionsSchema>, 'transports'>;

/**
 * Logging options type (with defaults applied).
 */
export type LoggingOptions = z.infer<typeof loggingOptionsSchema>;

/**
 * Logging options input type (for user configuration).
 */
export type LoggingOptionsInput = z.input<typeof loggingOptionsSchema>;
