// common/types/options/metrics/interfaces.ts
// Explicit TypeScript interfaces for better IDE autocomplete.
//
// Mirrors the shape used by `HealthOptionsInterface`. Keep these in sync with
// `schema.ts` via the `RawZodShape<MetricsOptionsInterface>` constraint.

/**
 * Output format for the /metrics endpoint.
 *
 * - `'prometheus'` — text exposition format (Content-Type
 *   `text/plain; version=0.0.4; charset=utf-8`). The default. Scrape-friendly
 *   for Prometheus, Grafana Agent, OpenMetrics-aware tooling.
 * - `'json'` — a `{ counters, gauges }` envelope for tooling that prefers
 *   JSON over text parsing.
 */
export type MetricsFormat = 'prometheus' | 'json';

/**
 * Authentication shape for the /metrics endpoint.
 *
 * - `'public'` — no auth (cluster-local convention, the default).
 * - `'token'` — `Authorization: Bearer <token>` required. The token is read
 *   from `process.env[tokenEnv]` at startup; if the env var is unset, the
 *   service constructor throws so misconfig is loud.
 * - `{ token: 'literal' }` — inline token (NOT recommended in production —
 *   tokens in source/config get committed by accident).
 */
export type MetricsAuth = 'public' | 'token' | { token: string };

/**
 * Metric category filter — exposes a knob for trimming the scrape payload.
 * The /metrics endpoint emits every category by default.
 */
export type MetricsCategory = 'process' | 'tools' | 'resources' | 'http' | 'storage' | 'skills' | 'auth' | 'sessions';

/**
 * Per-probe knobs for the built-in process-stats collector.
 */
export interface MetricsProcessOptionsInterface {
  /**
   * Emit `frontmcp_nodejs_eventloop_lag_seconds` (mean + p99). Requires
   * Node.js (uses `perf_hooks.monitorEventLoopDelay`). Auto-suppressed on
   * edge runtimes.
   *
   * @default true
   */
  eventLoopLag?: boolean;

  /**
   * Emit `frontmcp_nodejs_open_fds`. Linux only; collection wraps
   * `fs.readdirSync('/proc/self/fd')` in try/catch so non-Linux platforms
   * silently skip this gauge instead of throwing.
   *
   * @default true
   */
  fdCount?: boolean;

  /**
   * Emit `frontmcp_nodejs_active_handles` / `frontmcp_nodejs_active_requests`.
   * Uses `process._getActiveHandles()` / `_getActiveRequests()` which are
   * undocumented but stable since Node 14. Auto-suppressed when unavailable.
   *
   * @default true
   */
  activeHandles?: boolean;
}

/**
 * `/metrics` endpoint configuration for `@FrontMcp({ metrics: ... })`.
 *
 * **Default behaviour: OFF.** No `/metrics` route is registered until
 * `enabled: true` is set explicitly. This preserves the existing
 * security posture — process metrics, framework counter names, and tool
 * vocabularies can hint at deployment scale and feature usage, so the
 * default is opt-in.
 *
 * When enabled, the endpoint:
 * - Lives on the same HTTP listener as MCP traffic and `/healthz`.
 * - Defaults to Prometheus text format at `GET /metrics`.
 * - Is `auth: 'public'` by default (cluster-local convention) — switch to
 *   `auth: 'token'` for any internet-exposed deployment.
 * - Re-uses `@frontmcp/observability`'s in-memory counter snapshot store, so
 *   counters emitted by `createCounter()` are visible without standing up
 *   an OTel push pipeline.
 *
 * @example Enable with defaults
 * ```typescript
 * @FrontMcp({
 *   info: { name: 'my-server', version: '1.0.0' },
 *   apps: [MyApp],
 *   metrics: { enabled: true },
 * })
 * ```
 *
 * @example Token-gated
 * ```typescript
 * @FrontMcp({
 *   metrics: {
 *     enabled: true,
 *     auth: 'token',
 *     tokenEnv: 'FRONTMCP_METRICS_TOKEN',
 *   },
 * })
 * ```
 *
 * @example Trim to process metrics only
 * ```typescript
 * @FrontMcp({
 *   metrics: {
 *     enabled: true,
 *     include: ['process'],
 *   },
 * })
 * ```
 */
export interface MetricsOptionsInterface {
  /**
   * Enable the `/metrics` route.
   *
   * @default false
   */
  enabled?: boolean;

  /**
   * HTTP path for the endpoint. MUST NOT collide with MCP transport paths
   * (`/mcp`, `/sse`, `/messages`). A startup assertion in `MetricsService`
   * throws `MetricsPathConflictError` when a conflict is detected.
   *
   * @default '/metrics'
   */
  path?: string;

  /**
   * Output format. Prometheus text exposition (`'prometheus'`) is the
   * default; switch to `'json'` for tooling that prefers JSON.
   *
   * @default 'prometheus'
   */
  format?: MetricsFormat;

  /**
   * Authentication policy. `'public'` is the default to match the
   * cluster-local convention; switch to `'token'` for any internet-exposed
   * deployment. When `'token'`, the token is read from
   * `process.env[tokenEnv]` (default env var: `FRONTMCP_METRICS_TOKEN`).
   *
   * @default 'public'
   */
  auth?: MetricsAuth;

  /**
   * Environment variable name to read the bearer token from when
   * `auth: 'token'`. Ignored for other auth modes.
   *
   * @default 'FRONTMCP_METRICS_TOKEN'
   */
  tokenEnv?: string;

  /**
   * Category filter. When set, only categories listed here are emitted.
   * Omit to emit every category.
   */
  include?: MetricsCategory[];

  /**
   * Per-probe knobs for the built-in process-stats collector.
   */
  process?: MetricsProcessOptionsInterface;
}
