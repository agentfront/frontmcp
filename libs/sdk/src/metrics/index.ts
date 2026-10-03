// metrics/index.ts
// Barrel export for the /metrics endpoint subsystem (issue #397).

export {
  MetricsService,
  createProcessStatsCollectorIfEnabled,
  type MetricsResponse,
  type MetricsServiceOptions,
} from './metrics.service';
export {
  metricsPath,
  registerMetricsRoutes,
  renderMetricsScrape,
  type MetricsHttpResult,
  type MetricsRouteServer,
  type MetricsResponseLike,
} from './metrics.routes';
export { MetricsPathConflictError, MetricsTokenNotConfiguredError } from './metrics.errors';
