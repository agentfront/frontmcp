/**
 * SQLite Configuration Schema for SDK
 *
 * Zod schema for SQLite storage options used in FrontMCP config.
 */

import { z } from 'zod';
import type { RawZodShape } from '../../common.types';
import type { SqliteOptionsInterface } from './interfaces';

/**
 * SQLite storage configuration schema.
 */
export const sqliteOptionsSchema = z.object({
  /** Path to the .sqlite database file */
  path: z.string().min(1),

  /**
   * Encryption configuration for at-rest encryption of values.
   */
  encryption: z
    .object({
      /** Secret key material for AES-256-GCM encryption via HKDF-SHA256 */
      secret: z.string().min(1),
    })
    .optional(),

  /**
   * Interval in milliseconds for purging expired keys.
   * @default 60000
   */
  ttlCleanupIntervalMs: z.number().int().positive().optional().default(60000),

  /**
   * Enable WAL mode for better read concurrency.
   * @default true
   */
  walMode: z.boolean().optional().default(true),
} satisfies RawZodShape<SqliteOptionsInterface>);

/**
 * SQLite storage input type (before Zod defaults).
 * Uses explicit interface for better IDE autocomplete.
 */
export type SqliteOptionsInput = SqliteOptionsInterface;

/**
 * SQLite storage output type (after Zod defaults).
 */
export type SqliteOptions = z.infer<typeof sqliteOptionsSchema>;
