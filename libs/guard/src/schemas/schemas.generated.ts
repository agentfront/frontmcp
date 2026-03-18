// AUTO-GENERATED from Zod schemas — do not edit manually.
// Run: npx tsx scripts/generate-schema-types.mjs
// Source: scripts/generate-schema-types.mjs

import type { PartitionKey } from '../partition-key/types';

/**
 * Input type for concurrency control configuration.
 * All fields are optional for IDE autocomplete; required fields
 * are validated at runtime by concurrencyConfigSchema.
 */
export interface ConcurrencyConfigInput {
  /** Maximum number of concurrent executions allowed. */
  maxConcurrent?: number;
  /**
   * Maximum time in ms to wait in queue (0 = no wait).
   * @default 0
   */
  queueTimeoutMs?: number;
  /**
   * Partition key strategy.
   * @default "global"
   */
  partitionBy?: PartitionKey;
}

/**
 * Input type for rate limiting configuration.
 * All fields are optional for IDE autocomplete; required fields
 * are validated at runtime by rateLimitConfigSchema.
 */
export interface RateLimitConfigInput {
  /** Maximum number of requests allowed within the window. */
  maxRequests?: number;
  /**
   * Time window in milliseconds.
   * @default 60000
   */
  windowMs?: number;
  /**
   * Partition key strategy.
   * @default "global"
   */
  partitionBy?: PartitionKey;
}

/**
 * Input type for timeout configuration.
 * All fields are optional for IDE autocomplete; required fields
 * are validated at runtime by timeoutConfigSchema.
 */
export interface TimeoutConfigInput {
  /** Maximum execution time in milliseconds. */
  executeMs?: number;
}

/**
 * Input type for IP filtering configuration.
 * All fields are optional for IDE autocomplete; required fields
 * are validated at runtime by ipFilterConfigSchema.
 */
export interface IpFilterConfigInput {
  /** IP addresses or CIDR ranges to always allow. */
  allowList?: Array<string>;
  /** IP addresses or CIDR ranges to always block. */
  denyList?: Array<string>;
  /**
   * Default action when IP matches neither list.
   * @default "allow"
   */
  defaultAction?: 'allow' | 'deny';
  /**
   * Trust X-Forwarded-For header.
   * @default false
   */
  trustProxy?: boolean;
  /**
   * Max number of proxies to trust from X-Forwarded-For.
   * @default 1
   */
  trustedProxyDepth?: number;
}

/**
 * Input type for guard system configuration.
 * All fields are optional for IDE autocomplete; required fields
 * are validated at runtime by guardConfigSchema.
 */
export interface GuardConfigInput {
  /** Whether the guard system is enabled. */
  enabled?: boolean;
  /** Storage backend configuration. */
  storage?: Record<string, unknown>;
  /**
   * Key prefix for all storage keys.
   * @default "mcp:guard:"
   */
  keyPrefix?: string;
  /** Global rate limit applied to all requests. */
  global?: RateLimitConfigInput;
  /** Global concurrency limit. */
  globalConcurrency?: ConcurrencyConfigInput;
  /** Default rate limit for entities without explicit config. */
  defaultRateLimit?: RateLimitConfigInput;
  /** Default concurrency for entities without explicit config. */
  defaultConcurrency?: ConcurrencyConfigInput;
  /** Default timeout for entity execution. */
  defaultTimeout?: TimeoutConfigInput;
  /** IP filtering configuration. */
  ipFilter?: IpFilterConfigInput;
}
