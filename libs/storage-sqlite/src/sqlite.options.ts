/**
 * SQLite Storage Options
 *
 * Configuration types and Zod schema for SQLite-based storage.
 */

import { z } from 'zod';

/**
 * SQLite storage configuration options.
 */
export interface SqliteStorageOptions {
  /** Path to the .sqlite database file */
  path: string;

  /**
   * Encryption configuration for at-rest encryption of values.
   * Keys are stored in plaintext (needed for lookups), values are encrypted.
   */
  encryption?: {
    /** Secret key material for AES-256-GCM encryption via HKDF-SHA256 */
    secret: string;
  };

  /**
   * Interval in milliseconds for purging expired keys.
   * @default 60000
   */
  ttlCleanupIntervalMs?: number;

  /**
   * Enable WAL (Write-Ahead Logging) mode for better read concurrency.
   * @default true
   */
  walMode?: boolean;
}

/**
 * Zod schema for SQLite storage configuration.
 */
export const sqliteStorageOptionsSchema = z.object({
  path: z.string().min(1),
  encryption: z
    .object({
      secret: z.string().min(1),
    })
    .optional(),
  ttlCleanupIntervalMs: z.number().int().positive().optional().default(60000),
  walMode: z.boolean().optional().default(true),
});

/**
 * SQLite storage input type (before Zod defaults).
 */
export type SqliteStorageOptionsInput = z.input<typeof sqliteStorageOptionsSchema>;

/**
 * SQLite storage output type (after Zod defaults).
 */
export type SqliteStorageOptionsParsed = z.infer<typeof sqliteStorageOptionsSchema>;
