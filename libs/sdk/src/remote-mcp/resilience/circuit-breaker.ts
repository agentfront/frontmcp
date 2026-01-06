/**
 * @file circuit-breaker.ts
 * @description Circuit breaker pattern for preventing cascading failures in remote MCP operations
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before attempting to close circuit (default: 30000) */
  resetTimeoutMs?: number;
  /** Number of successful calls in half-open to close circuit (default: 2) */
  successThreshold?: number;
  /** Time window in ms for counting failures (default: 60000) */
  failureWindowMs?: number;
  /** Callback when state changes */
  onStateChange?: (state: CircuitState, previousState: CircuitState) => void;
}

const DEFAULT_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  successThreshold: 2,
  failureWindowMs: 60000,
  onStateChange: () => {},
};

interface FailureRecord {
  timestamp: number;
  error: Error;
}

/**
 * Circuit breaker for a specific remote app connection.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures exceeded threshold, requests fail immediately
 * - HALF-OPEN: Testing if service recovered, limited requests allowed
 */
export class CircuitBreaker {
  private readonly appId: string;
  private readonly options: Required<CircuitBreakerOptions>;

  private state: CircuitState = 'closed';
  private failures: FailureRecord[] = [];
  private successCount = 0;
  private lastFailureTime?: number;
  private nextAttemptTime?: number;

  constructor(appId: string, options: CircuitBreakerOptions = {}) {
    this.appId = appId;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if the circuit allows requests
   */
  canExecute(): boolean {
    this.cleanOldFailures();

    switch (this.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if reset timeout has passed
        if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
          this.transitionTo('half-open');
          return true;
        }
        return false;

      case 'half-open':
        // Allow limited requests for testing
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    switch (this.state) {
      case 'half-open':
        this.successCount++;
        if (this.successCount >= this.options.successThreshold) {
          this.transitionTo('closed');
        }
        break;

      case 'closed':
        // Reset failure count on success in closed state
        // This helps recover from sporadic failures
        if (this.failures.length > 0) {
          this.failures = [];
        }
        break;
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(error: Error): void {
    const now = Date.now();
    this.failures.push({ timestamp: now, error });
    this.lastFailureTime = now;

    switch (this.state) {
      case 'closed':
        this.cleanOldFailures();
        if (this.failures.length >= this.options.failureThreshold) {
          this.transitionTo('open');
        }
        break;

      case 'half-open':
        // Single failure in half-open returns to open
        this.transitionTo('open');
        break;
    }
  }

  /**
   * Force reset the circuit to closed state
   */
  reset(): void {
    this.transitionTo('closed');
    this.failures = [];
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptTime = undefined;
  }

  /**
   * Get circuit breaker stats
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime?: number;
    nextAttemptTime?: number;
  } {
    this.cleanOldFailures();
    return {
      state: this.state,
      failureCount: this.failures.length,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const previousState = this.state;
    this.state = newState;

    switch (newState) {
      case 'open':
        this.nextAttemptTime = Date.now() + this.options.resetTimeoutMs;
        this.successCount = 0;
        break;

      case 'half-open':
        this.successCount = 0;
        break;

      case 'closed':
        this.failures = [];
        this.successCount = 0;
        this.nextAttemptTime = undefined;
        break;
    }

    this.options.onStateChange(newState, previousState);
  }

  private cleanOldFailures(): void {
    const cutoff = Date.now() - this.options.failureWindowMs;
    this.failures = this.failures.filter((f) => f.timestamp > cutoff);
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  readonly appId: string;
  readonly nextAttemptTime?: number;

  constructor(appId: string, nextAttemptTime?: number) {
    const waitTime = nextAttemptTime ? Math.ceil((nextAttemptTime - Date.now()) / 1000) : 0;
    super(`Circuit breaker is open for ${appId}. Retry in ${waitTime}s`);
    this.name = 'CircuitOpenError';
    this.appId = appId;
    this.nextAttemptTime = nextAttemptTime;
  }
}

/**
 * Manager for multiple circuit breakers (one per remote app)
 */
export class CircuitBreakerManager {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly defaultOptions: CircuitBreakerOptions;

  constructor(defaultOptions: CircuitBreakerOptions = {}) {
    this.defaultOptions = defaultOptions;
  }

  /**
   * Get or create a circuit breaker for an app
   */
  getBreaker(appId: string, options?: CircuitBreakerOptions): CircuitBreaker {
    let breaker = this.breakers.get(appId);
    if (!breaker) {
      breaker = new CircuitBreaker(appId, { ...this.defaultOptions, ...options });
      this.breakers.set(appId, breaker);
    }
    return breaker;
  }

  /**
   * Remove a circuit breaker
   */
  removeBreaker(appId: string): void {
    this.breakers.delete(appId);
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get stats for all circuit breakers
   */
  getAllStats(): Map<string, ReturnType<CircuitBreaker['getStats']>> {
    const stats = new Map<string, ReturnType<CircuitBreaker['getStats']>>();
    for (const [appId, breaker] of this.breakers) {
      stats.set(appId, breaker.getStats());
    }
    return stats;
  }
}
