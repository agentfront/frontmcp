/**
 * OpenAPI Spec Poller Types
 *
 * Type definitions for the OpenAPI specification polling system.
 *
 * @packageDocumentation
 */

/**
 * Change detection strategy.
 */
export type SpecChangeDetection = 'content-hash' | 'etag' | 'auto';

/**
 * Retry configuration for failed polls.
 */
export interface SpecPollerRetryConfig {
  /** Maximum number of retries per poll cycle @default 3 */
  maxRetries?: number;
  /** Initial delay before first retry in ms @default 1000 */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms @default 10000 */
  maxDelayMs?: number;
  /** Backoff multiplier @default 2 */
  backoffMultiplier?: number;
}

/**
 * Health status of the poller.
 */
export type PollerHealthStatus = 'healthy' | 'unhealthy' | 'unknown';

/**
 * Configuration for the OpenAPI spec poller.
 */
export interface SpecPollerOptions {
  /** Poll interval in milliseconds @default 60000 */
  intervalMs?: number;
  /** Fetch timeout in milliseconds @default 10000 */
  fetchTimeoutMs?: number;
  /** Change detection strategy @default 'auto' */
  changeDetection?: SpecChangeDetection;
  /** Retry configuration */
  retry?: SpecPollerRetryConfig;
  /** Number of consecutive failures before marking unhealthy @default 3 */
  unhealthyThreshold?: number;
  /** Additional headers for fetch requests */
  headers?: Record<string, string>;
}

/**
 * Callback types for spec poller events.
 */
export interface SpecPollerCallbacks {
  /** Called when the spec content has changed */
  onChanged?: (spec: string, hash: string) => void;
  /** Called when the spec hasn't changed */
  onUnchanged?: () => void;
  /** Called on poll error */
  onError?: (error: Error) => void;
  /** Called when poller becomes unhealthy */
  onUnhealthy?: (consecutiveFailures: number) => void;
  /** Called when poller recovers from unhealthy state */
  onRecovered?: () => void;
}

/**
 * Spec poller stats for monitoring.
 */
export interface SpecPollerStats {
  /** Current content hash */
  hash: string | null;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Health status */
  health: PollerHealthStatus;
  /** Whether the poller is currently running */
  isRunning: boolean;
}
