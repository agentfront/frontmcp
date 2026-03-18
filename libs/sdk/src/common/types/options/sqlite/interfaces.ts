// common/types/options/sqlite/interfaces.ts
// Explicit TypeScript interfaces for SQLite configuration

/**
 * SQLite storage configuration options.
 */
export interface SqliteOptionsInterface {
  /** Path to the .sqlite database file */
  path: string;

  /**
   * Encryption configuration for at-rest encryption of values.
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
   * Enable WAL mode for better read concurrency.
   * @default true
   */
  walMode?: boolean;
}
