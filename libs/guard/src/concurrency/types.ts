/**
 * Concurrency Control Types
 */

import type { PartitionKey } from '../partition-key/types';

/**
 * Concurrency control configuration.
 */
export interface ConcurrencyConfig {
  /** Maximum number of concurrent executions allowed. */
  maxConcurrent: number;
  /** Maximum time in ms to wait in queue (0 = no wait). @default 0 */
  queueTimeoutMs?: number;
  /** Partition key strategy. @default 'global' */
  partitionBy?: PartitionKey;
}

/**
 * A semaphore ticket representing an acquired concurrency slot.
 */
export interface SemaphoreTicket {
  ticket: string;
  release: () => Promise<void>;
}
