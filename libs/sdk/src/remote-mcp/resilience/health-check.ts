/**
 * @file health-check.ts
 * @description Health check mechanism for proactive monitoring of remote MCP connections
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheckResult {
  status: HealthStatus;
  latencyMs?: number;
  lastChecked: Date;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  error?: string;
}

export interface HealthCheckOptions {
  /** Interval between health checks in ms (default: 30000) */
  intervalMs?: number;
  /** Timeout for health check in ms (default: 5000) */
  timeoutMs?: number;
  /** Number of failures before marking unhealthy (default: 3) */
  unhealthyThreshold?: number;
  /** Number of successes before marking healthy (default: 2) */
  healthyThreshold?: number;
  /** Latency threshold for degraded status in ms (default: 2000) */
  degradedLatencyMs?: number;
  /** Callback on health status change */
  onStatusChange?: (appId: string, status: HealthStatus, previousStatus: HealthStatus) => void;
}

const DEFAULT_OPTIONS: Required<HealthCheckOptions> = {
  intervalMs: 30000,
  timeoutMs: 5000,
  unhealthyThreshold: 3,
  healthyThreshold: 2,
  degradedLatencyMs: 2000,
  onStatusChange: () => {},
};

/**
 * Health checker for a single remote MCP connection
 */
export class HealthChecker {
  private readonly appId: string;
  private readonly options: Required<HealthCheckOptions>;
  private readonly checkFn: () => Promise<void>;

  private status: HealthStatus = 'unknown';
  private lastResult?: HealthCheckResult;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private intervalTimer?: ReturnType<typeof setInterval>;
  private isChecking = false;

  constructor(appId: string, checkFn: () => Promise<void>, options: HealthCheckOptions = {}) {
    this.appId = appId;
    this.checkFn = checkFn;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.intervalTimer) return;

    // Do an initial check
    this.check().catch(() => {});

    // Start periodic checks
    this.intervalTimer = setInterval(() => {
      this.check().catch(() => {});
    }, this.options.intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
  }

  /**
   * Perform a single health check
   */
  async check(): Promise<HealthCheckResult> {
    // Prevent overlapping checks
    if (this.isChecking) {
      return (
        this.lastResult || {
          status: this.status,
          lastChecked: new Date(),
          consecutiveFailures: this.consecutiveFailures,
          consecutiveSuccesses: this.consecutiveSuccesses,
        }
      );
    }

    this.isChecking = true;
    const startTime = Date.now();

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.options.timeoutMs);
      });

      // Race check against timeout
      await Promise.race([this.checkFn(), timeoutPromise]);

      const latencyMs = Date.now() - startTime;
      this.consecutiveSuccesses++;
      this.consecutiveFailures = 0;

      // Determine status based on latency and thresholds
      const previousStatus = this.status;
      if (this.consecutiveSuccesses >= this.options.healthyThreshold) {
        this.status = latencyMs > this.options.degradedLatencyMs ? 'degraded' : 'healthy';
      }

      this.lastResult = {
        status: this.status,
        latencyMs,
        lastChecked: new Date(),
        consecutiveFailures: this.consecutiveFailures,
        consecutiveSuccesses: this.consecutiveSuccesses,
      };

      if (this.status !== previousStatus) {
        this.options.onStatusChange(this.appId, this.status, previousStatus);
      }

      return this.lastResult;
    } catch (error) {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;

      const previousStatus = this.status;
      if (this.consecutiveFailures >= this.options.unhealthyThreshold) {
        this.status = 'unhealthy';
      }

      this.lastResult = {
        status: this.status,
        lastChecked: new Date(),
        consecutiveFailures: this.consecutiveFailures,
        consecutiveSuccesses: this.consecutiveSuccesses,
        error: (error as Error).message,
      };

      if (this.status !== previousStatus) {
        this.options.onStatusChange(this.appId, this.status, previousStatus);
      }

      return this.lastResult;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Get current health status
   */
  getStatus(): HealthStatus {
    return this.status;
  }

  /**
   * Get last check result
   */
  getLastResult(): HealthCheckResult | undefined {
    return this.lastResult;
  }

  /**
   * Reset health checker state
   */
  reset(): void {
    this.status = 'unknown';
    this.lastResult = undefined;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  /**
   * Mark as healthy (e.g., after successful operation)
   */
  markHealthy(): void {
    const previousStatus = this.status;
    this.status = 'healthy';
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    if (previousStatus !== 'healthy') {
      this.options.onStatusChange(this.appId, 'healthy', previousStatus);
    }
  }

  /**
   * Mark as unhealthy (e.g., after failed operation)
   */
  markUnhealthy(error?: Error): void {
    const previousStatus = this.status;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.consecutiveFailures >= this.options.unhealthyThreshold) {
      this.status = 'unhealthy';
      if (previousStatus !== 'unhealthy') {
        this.options.onStatusChange(this.appId, 'unhealthy', previousStatus);
      }
    }
  }
}

/**
 * Manager for multiple health checkers (one per remote app)
 */
export class HealthCheckManager {
  private readonly checkers = new Map<string, HealthChecker>();
  private readonly defaultOptions: HealthCheckOptions;

  constructor(defaultOptions: HealthCheckOptions = {}) {
    this.defaultOptions = defaultOptions;
  }

  /**
   * Create and start a health checker for an app
   */
  addChecker(appId: string, checkFn: () => Promise<void>, options?: HealthCheckOptions): HealthChecker {
    // Stop existing checker if any
    this.removeChecker(appId);

    const checker = new HealthChecker(appId, checkFn, {
      ...this.defaultOptions,
      ...options,
    });
    this.checkers.set(appId, checker);
    checker.start();

    return checker;
  }

  /**
   * Remove and stop a health checker
   */
  removeChecker(appId: string): void {
    const checker = this.checkers.get(appId);
    if (checker) {
      checker.stop();
      this.checkers.delete(appId);
    }
  }

  /**
   * Get health checker for an app
   */
  getChecker(appId: string): HealthChecker | undefined {
    return this.checkers.get(appId);
  }

  /**
   * Get health status for all apps
   */
  getAllStatuses(): Map<string, HealthCheckResult | undefined> {
    const statuses = new Map<string, HealthCheckResult | undefined>();
    for (const [appId, checker] of this.checkers) {
      statuses.set(appId, checker.getLastResult());
    }
    return statuses;
  }

  /**
   * Stop all health checkers
   */
  stopAll(): void {
    for (const checker of this.checkers.values()) {
      checker.stop();
    }
  }

  /**
   * Dispose and clean up
   */
  dispose(): void {
    this.stopAll();
    this.checkers.clear();
  }
}
