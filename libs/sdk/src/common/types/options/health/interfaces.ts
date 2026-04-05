// common/types/options/health/interfaces.ts
// Explicit TypeScript interfaces for better IDE autocomplete
//
// These interfaces provide comprehensive JSDoc documentation and better
// IDE autocomplete experience than z.infer types. The schemas in schema.ts
// use these interfaces via RawZodShape constraint to ensure type sync.
//
// IMPORTANT: Keep these interfaces in sync with the Zod schemas.

// ============================================
// HEALTH PROBE RESULT
// ============================================

/**
 * Result of a single health probe execution.
 */
export interface HealthProbeResult {
  /** Probe status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Time taken to execute the probe in milliseconds */
  latencyMs?: number;
  /** Additional probe-specific details */
  details?: Record<string, unknown>;
  /** Error message if the probe failed */
  error?: string;
}

// ============================================
// HEALTH PROBE DEFINITION
// ============================================

/**
 * User-defined health probe for custom dependency checks.
 *
 * @example Redis cluster probe
 * ```typescript
 * const redisClusterProbe: HealthProbeDefinition = {
 *   name: 'redis-cluster',
 *   async check() {
 *     const start = Date.now();
 *     await redisCluster.ping();
 *     return { status: 'healthy', latencyMs: Date.now() - start };
 *   },
 * };
 * ```
 */
export interface HealthProbeDefinition {
  /** Unique probe name (appears in /readyz response) */
  name: string;
  /** Execute the health check and return the result */
  check(): Promise<HealthProbeResult>;
}

// ============================================
// READYZ OPTIONS
// ============================================

/**
 * Readiness probe sub-configuration.
 */
export interface HealthReadyzOptionsInterface {
  /**
   * Enable the readiness endpoint.
   *
   * When omitted, auto-determined by runtime:
   * - Node.js, Bun, Deno, Browser: enabled
   * - Edge/Cloudflare/Vercel (serverless): disabled
   *
   * @default undefined (auto-detect)
   */
  enabled?: boolean;

  /**
   * Timeout per probe in milliseconds.
   * Probes exceeding this timeout are marked as unhealthy.
   *
   * @default 5000
   */
  timeoutMs?: number;
}

// ============================================
// HEALTH OPTIONS INTERFACE
// ============================================

/**
 * Health and readiness endpoint configuration for @FrontMcp decorator.
 *
 * Provides Kubernetes-style `/healthz` (liveness) and `/readyz` (readiness) endpoints
 * with runtime introspection, dependency probing, and catalog hashing.
 *
 * **`/healthz` (liveness):**
 * - Lightweight, no I/O
 * - Returns server info, runtime context, uptime
 * - Available on all runtimes
 *
 * **`/readyz` (readiness):**
 * - Probes all registered dependencies (Redis, session store, event store, remote apps)
 * - Returns catalog hash, registry counts, per-probe status
 * - Available on Node.js, Bun, Deno, Browser (disabled on edge/serverless)
 *
 * @example Default (auto-enabled)
 * ```typescript
 * @FrontMcp({
 *   info: { name: 'my-server', version: '1.0.0' },
 *   apps: [MyApp],
 *   // health endpoints enabled by default
 * })
 * ```
 *
 * @example Custom paths
 * ```typescript
 * @FrontMcp({
 *   health: {
 *     healthzPath: '/live',
 *     readyzPath: '/ready',
 *   },
 * })
 * ```
 *
 * @example Custom probes
 * ```typescript
 * @FrontMcp({
 *   health: {
 *     probes: [{
 *       name: 'postgres',
 *       async check() {
 *         await pool.query('SELECT 1');
 *         return { status: 'healthy' };
 *       },
 *     }],
 *   },
 * })
 * ```
 *
 * @example Disable health endpoints
 * ```typescript
 * @FrontMcp({
 *   health: { enabled: false },
 * })
 * ```
 */
export interface HealthOptionsInterface {
  /**
   * Enable health endpoints.
   *
   * When disabled, only the legacy `/health` endpoint is registered
   * for backwards compatibility.
   *
   * @default true
   */
  enabled?: boolean;

  /**
   * Path for the liveness probe endpoint.
   *
   * @default '/healthz'
   */
  healthzPath?: string;

  /**
   * Path for the readiness probe endpoint.
   *
   * @default '/readyz'
   */
  readyzPath?: string;

  /**
   * Custom health probes for user-defined dependency checks.
   *
   * These probes are executed alongside auto-discovered probes
   * (session store, elicitation store, event store, remote apps)
   * when the `/readyz` endpoint is called.
   */
  probes?: HealthProbeDefinition[];

  /**
   * Include per-probe details in the readiness response.
   *
   * When false, only the aggregate status is returned.
   * Useful for production to avoid leaking infrastructure topology.
   *
   * @default true in development, false in production
   */
  includeDetails?: boolean;

  /**
   * Readiness endpoint configuration.
   */
  readyz?: HealthReadyzOptionsInterface;
}
