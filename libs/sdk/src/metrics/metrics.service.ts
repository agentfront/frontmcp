/**
 * @file metrics.service.ts
 * @description Core service backing the `/metrics` endpoint (issue #397).
 */

import type { CounterSnapshotEntry, GaugeSnapshotEntry, ProcessStatsCollector } from '@frontmcp/observability';

import type { MetricsCategory, MetricsOptionsInterface } from '../common';
import { MetricsPathConflictError, MetricsTokenNotConfiguredError } from './metrics.errors';

// Canonical Prometheus 0.0.4 content type. Pinned here to avoid a runtime
// import of @frontmcp/observability at module-init time (sdk → observability
// → sdk circular load). Must stay byte-identical to
// `PROMETHEUS_CONTENT_TYPE` exported from @frontmcp/observability.
const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

// Lazy-loaded handles to break the import cycle between @frontmcp/sdk and
// @frontmcp/observability. The observability bundle imports HttpHook from
// @frontmcp/sdk at module init; if metrics.service.ts pulled observability
// at import time, sdk's init would re-enter observability while observability
// was still resolving HttpHook, producing `HttpHook is undefined` at decorator
// application time. require() at first call resolves the cycle naturally.
type ObservabilityRuntime = {
  getMetricSnapshot: () => CounterSnapshotEntry[];
  renderPrometheusExposition: (counters: CounterSnapshotEntry[], gauges?: GaugeSnapshotEntry[]) => string;
  renderJsonExposition: (
    counters: CounterSnapshotEntry[],
    gauges?: GaugeSnapshotEntry[],
  ) => { counters: CounterSnapshotEntry[]; gauges: GaugeSnapshotEntry[] };
};

let observabilityRuntime: ObservabilityRuntime | undefined;
function loadObservability(): ObservabilityRuntime {
  if (!observabilityRuntime) {
    observabilityRuntime = require('@frontmcp/observability') as ObservabilityRuntime;
  }
  return observabilityRuntime;
}

const MCP_RESERVED_PATH_PREFIXES = ['/mcp', '/sse', '/messages'];

/** Default category → counter-prefix mapping used when `include` is set. */
const COUNTER_CATEGORY_PREFIX: Record<MetricsCategory, string[]> = {
  process: ['frontmcp_process_', 'frontmcp_nodejs_'],
  skills: ['frontmcp_skills_'],
  tools: ['frontmcp_tool_'],
  resources: ['frontmcp_resource_'],
  http: ['frontmcp_http_'],
  storage: ['frontmcp_storage_'],
  auth: ['frontmcp_auth_'],
  sessions: ['frontmcp_session_'],
};

/**
 * Resolved metrics body + content type, returned by `getMetrics()`.
 */
export interface MetricsResponse {
  contentType: string;
  body: string;
}

/**
 * Test-injection seam for the counter snapshot source — production callers
 * never set this.
 */
export interface MetricsServiceOptions {
  snapshotSource?: () => CounterSnapshotEntry[];
}

export class MetricsService {
  private readonly config: MetricsOptionsInterface;
  private readonly processCollector?: ProcessStatsCollector;
  private readonly snapshotSource: () => CounterSnapshotEntry[];
  private readonly resolvedToken?: string;

  constructor(
    config: MetricsOptionsInterface,
    processCollector?: ProcessStatsCollector,
    options: MetricsServiceOptions = {},
  ) {
    this.config = config;
    this.processCollector = processCollector;
    this.snapshotSource = options.snapshotSource ?? (() => loadObservability().getMetricSnapshot());

    const path = config.path ?? '/metrics';
    for (const prefix of MCP_RESERVED_PATH_PREFIXES) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        throw new MetricsPathConflictError(path);
      }
    }

    if (config.auth === 'token') {
      const envName = config.tokenEnv ?? 'FRONTMCP_METRICS_TOKEN';
      const value = process.env[envName];
      if (!value) {
        throw new MetricsTokenNotConfiguredError(envName);
      }
      this.resolvedToken = value;
    } else if (typeof config.auth === 'object' && config.auth !== null && 'token' in config.auth) {
      this.resolvedToken = config.auth.token;
    }
  }

  /**
   * Render the current metrics scrape in the configured format.
   */
  getMetrics(): MetricsResponse {
    const format = this.config.format ?? 'prometheus';
    const include = this.config.include;

    let counters = this.snapshotSource();
    let gauges: GaugeSnapshotEntry[] = this.processCollector?.collect() ?? [];

    if (include && include.length > 0) {
      const includeSet = new Set(include);
      const allowedPrefixes = include.flatMap((category) => COUNTER_CATEGORY_PREFIX[category] ?? []);
      const matchesAllowed = (name: string) => allowedPrefixes.some((prefix) => name.startsWith(prefix));
      counters = counters.filter((c) => matchesAllowed(c.name));
      if (!includeSet.has('process')) {
        gauges = [];
      } else {
        gauges = gauges.filter((g) => matchesAllowed(g.name));
      }
    }

    const obs = loadObservability();
    if (format === 'json') {
      return {
        contentType: 'application/json',
        body: JSON.stringify(obs.renderJsonExposition(counters, gauges)),
      };
    }
    return {
      contentType: PROMETHEUS_CONTENT_TYPE,
      body: obs.renderPrometheusExposition(counters, gauges),
    };
  }

  /**
   * Check the supplied `Authorization` header against the configured auth
   * policy. Returns the HTTP status the route should respond with:
   *   - 200 — the request is allowed to read metrics
   *   - 401 — missing credentials when token auth is configured
   *   - 403 — wrong credentials
   */
  authorize(authorizationHeader: string | undefined): 200 | 401 | 403 {
    const auth = this.config.auth ?? 'public';
    if (auth === 'public') return 200;
    if (!authorizationHeader) return 401;
    const expected = this.resolvedToken;
    if (!expected) return 401;
    const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
    if (!match) return 401;
    return match[1] === expected ? 200 : 403;
  }
}
