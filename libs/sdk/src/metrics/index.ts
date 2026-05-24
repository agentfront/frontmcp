// metrics/index.ts
// Barrel export for the /metrics endpoint subsystem (issue #397).

export {
  MetricsService,
  createProcessStatsCollectorIfEnabled,
  type MetricsResponse,
  type MetricsServiceOptions,
} from './metrics.service';
export { registerMetricsRoutes, type MetricsRouteServer, type MetricsResponseLike } from './metrics.routes';
export { MetricsPathConflictError, MetricsTokenNotConfiguredError } from './metrics.errors';
