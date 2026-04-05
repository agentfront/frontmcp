// health/index.ts
// Barrel export for health and readiness system

// ============================================
// TYPES
// ============================================
export type { HealthProbe, HealthProbeResult, HealthzResponse, ReadyzResponse, CatalogInfo } from './health.types';

// ============================================
// PROBES
// ============================================
export { createStorageProbe, createRemoteAppProbe, createTransportSessionProbe } from './health.probes';
export type { Pingable, HealthResultProvider, SessionStorePingProvider } from './health.probes';

// ============================================
// SERVICE
// ============================================
export { HealthService } from './health.service';
export type { HealthScopeView } from './health.service';

// ============================================
// ROUTES
// ============================================
export { registerHealthRoutes, isReadyzEnabled } from './health.routes';
export type { HealthRouteServer } from './health.routes';
