/**
 * OpenAPI Spec Poller
 *
 * Polls an OpenAPI specification URL for changes using content-hash detection.
 * Uses @frontmcp/utils for crypto operations (sha256Hex) and follows the
 * HealthChecker pattern from libs/sdk/src/remote-mcp/resilience/health-check.ts.
 *
 * @packageDocumentation
 */

import { sha256Hex } from '@frontmcp/utils';
import type {
  SpecPollerOptions,
  SpecPollerCallbacks,
  SpecPollerStats,
  SpecPollerRetryConfig,
  PollerHealthStatus,
} from './openapi-spec-poller.types';

const DEFAULT_RETRY: Required<SpecPollerRetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Polls an OpenAPI spec URL for changes using content-hash and ETag detection.
 * Follows the callback-based emitter pattern (like ToolEmitter).
 */
export class OpenApiSpecPoller {
  private readonly url: string;
  private readonly intervalMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly changeDetection: 'content-hash' | 'etag' | 'auto';
  private readonly retry: Required<SpecPollerRetryConfig>;
  private readonly unhealthyThreshold: number;
  private readonly headers: Record<string, string>;
  private readonly callbacks: SpecPollerCallbacks;

  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private lastHash: string | null = null;
  private lastEtag: string | null = null;
  private lastModified: string | null = null;
  private consecutiveFailures = 0;
  private isPolling = false;
  private wasUnhealthy = false;
  private health: PollerHealthStatus = 'unknown';

  constructor(url: string, options: SpecPollerOptions = {}, callbacks: SpecPollerCallbacks = {}) {
    this.url = url;
    this.intervalMs = options.intervalMs ?? 60000;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 10000;
    this.changeDetection = options.changeDetection ?? 'auto';
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.unhealthyThreshold = options.unhealthyThreshold ?? 3;
    this.headers = options.headers ?? {};
    this.callbacks = callbacks;
  }

  /**
   * Start polling for changes.
   */
  start(): void {
    if (this.intervalTimer) return;

    // Initial poll
    this.poll().catch(() => {});

    this.intervalTimer = setInterval(() => {
      this.poll().catch(() => {});
    }, this.intervalMs);
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Get current stats.
   */
  getStats(): SpecPollerStats {
    return {
      hash: this.lastHash,
      consecutiveFailures: this.consecutiveFailures,
      health: this.health,
      isRunning: this.intervalTimer !== null,
    };
  }

  /**
   * Perform a single poll cycle.
   */
  async poll(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      await this.fetchWithRetry();
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchWithRetry(): Promise<void> {
    const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier } = this.retry;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.doFetch();
        // Success
        if (this.consecutiveFailures > 0) {
          this.consecutiveFailures = 0;
          if (this.wasUnhealthy) {
            this.wasUnhealthy = false;
            this.health = 'healthy';
            this.callbacks.onRecovered?.();
          }
        }
        this.health = 'healthy';
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          this.consecutiveFailures++;
          this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));

          if (this.consecutiveFailures >= this.unhealthyThreshold && !this.wasUnhealthy) {
            this.wasUnhealthy = true;
            this.health = 'unhealthy';
            this.callbacks.onUnhealthy?.(this.consecutiveFailures);
          }
          return;
        }

        const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async doFetch(): Promise<void> {
    const headers: Record<string, string> = { ...this.headers };

    // Add conditional request headers
    if (this.changeDetection !== 'content-hash') {
      if (this.lastEtag) {
        headers['If-None-Match'] = this.lastEtag;
      }
      if (this.lastModified) {
        headers['If-Modified-Since'] = this.lastModified;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const response = await fetch(this.url, {
        headers,
        signal: controller.signal,
      });

      // HTTP 304: Not Modified
      if (response.status === 304) {
        this.callbacks.onUnchanged?.();
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Store ETag and Last-Modified for next request
      const etag = response.headers.get('etag');
      const lastModified = response.headers.get('last-modified');
      if (etag) this.lastEtag = etag;
      if (lastModified) this.lastModified = lastModified;

      const body = await response.text();
      const hash = sha256Hex(body);

      if (this.lastHash && this.lastHash === hash) {
        this.callbacks.onUnchanged?.();
        return;
      }

      this.lastHash = hash;
      this.callbacks.onChanged?.(body, hash);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Dispose the poller and release resources.
   */
  dispose(): void {
    this.stop();
  }
}
