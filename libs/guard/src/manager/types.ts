/**
 * Guard Manager Types
 */

import type { StorageConfig } from '@frontmcp/utils';
import type { RateLimitConfig } from '../rate-limit/types';
import type { ConcurrencyConfig } from '../concurrency/types';
import type { TimeoutConfig } from '../timeout/types';
import type { IpFilterConfig } from '../ip-filter/types';

/**
 * Full guard configuration — SDK-agnostic.
 */
export interface GuardConfig {
  /** Whether the guard system is enabled. */
  enabled: boolean;
  /** Storage backend. */
  storage?: StorageConfig;
  /** Key prefix for all storage keys. @default 'mcp:guard:' */
  keyPrefix?: string;
  /** Global rate limit applied to ALL requests. */
  global?: RateLimitConfig;
  /** Global concurrency limit. */
  globalConcurrency?: ConcurrencyConfig;
  /** Default rate limit for entities without explicit config. */
  defaultRateLimit?: RateLimitConfig;
  /** Default concurrency for entities without explicit config. */
  defaultConcurrency?: ConcurrencyConfig;
  /** Default timeout for entity execution. */
  defaultTimeout?: TimeoutConfig;
  /** IP filtering configuration. */
  ipFilter?: IpFilterConfig;
}

/**
 * Minimal logger interface — any logger that has info/warn methods.
 */
export interface GuardLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

/**
 * Arguments for createGuardManager factory.
 */
export interface CreateGuardManagerArgs {
  config: GuardConfig;
  logger?: GuardLogger;
}
