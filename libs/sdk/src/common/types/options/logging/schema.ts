// common/types/options/logging/schema.ts
// Zod schema for logging configuration

import { z } from '@frontmcp/lazy-zod';
import { getEnv, getRuntimeContext } from '@frontmcp/utils';

import { annotatedFrontMcpLoggerSchema } from '../../../schemas';
import type { RawZodShape } from '../../common.types';
import { LogLevel, LogLevelName, type LoggingOptionsInterface } from './interfaces';

/** The level `FRONTMCP_LOG_LEVEL` names (`debug`, `verbose`, `info`, `warn`, `error` or `off`, in any case), if any. */
export function logLevelFromEnv(): LogLevel | undefined {
  const name = getEnv('FRONTMCP_LOG_LEVEL')?.trim().toLowerCase();
  const match = Object.entries(LogLevelName).find(([, levelName]) => levelName === name);
  return match ? (Number(match[0]) as LogLevel) : undefined;
}

/**
 * Logging options Zod schema.
 */
export const loggingOptionsSchema = z.object({
  level: z
    .nativeEnum(LogLevel)
    .optional()
    .default(() => logLevelFromEnv() ?? (getRuntimeContext().runtime === 'browser' ? LogLevel.Warn : LogLevel.Info)),
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
 * Uses explicit interface for better IDE autocomplete.
 */
export type LoggingOptionsInput = LoggingOptionsInterface;
