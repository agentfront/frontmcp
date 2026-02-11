/**
 * SQLite Configuration Schema for SDK
 *
 * Zod schema for SQLite storage options used in FrontMCP config.
 */

import { z } from 'zod';

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
});

/**
 * SQLite storage input type (before Zod defaults).
 */
export type SqliteOptionsInput = z.input<typeof sqliteOptionsSchema>;

/**
 * SQLite storage output type (after Zod defaults).
 */
export type SqliteOptions = z.infer<typeof sqliteOptionsSchema>;
