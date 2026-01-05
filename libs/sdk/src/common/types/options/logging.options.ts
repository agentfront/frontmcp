import { z } from 'zod';
import { annotatedFrontMcpLoggerSchema } from '../../schemas';
import { LogTransportType } from '../../interfaces';
import { RawZodShape } from '../common.types';

export enum LogLevel {
  Debug = 0,
  Verbose = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
  Off = 100, // never log
}

export const LogLevelName: Record<LogLevel, string> = {
  [LogLevel.Debug]: 'debug',
  [LogLevel.Verbose]: 'verbose',
  [LogLevel.Info]: 'info',
  [LogLevel.Warn]: 'warn',
  [LogLevel.Error]: 'error',
  [LogLevel.Off]: 'off',
};

export type LoggingOptions = {
  level?: LogLevel; // default to 'info'
  enableConsole?: boolean;
  prefix?: string;
  /**
   * Additional custom LogTransport types to register.
   * @default []
   */
  transports?: LogTransportType[];
};

export const loggingOptionsSchema = z.object({
  level: z.nativeEnum(LogLevel).optional().default(LogLevel.Info),
  prefix: z.string().optional(),
  enableConsole: z.boolean().optional().default(true),
  transports: z.array(annotatedFrontMcpLoggerSchema).optional().default([]),
} satisfies RawZodShape<LoggingOptions>);

export type LoggingConfigType = Omit<z.infer<typeof loggingOptionsSchema>, 'transports'>;
