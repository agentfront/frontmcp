// common/types/options/health/index.ts
// Barrel export for health options

// ============================================
// EXPLICIT INTERFACES (for better autocomplete)
// ============================================
export type {
  HealthOptionsInterface,
  HealthReadyzOptionsInterface,
  HealthProbeDefinition,
  HealthProbeResult,
} from './interfaces';

// ============================================
// SCHEMAS & DEFAULTS
// ============================================
export { healthOptionsSchema, healthReadyzOptionsSchema, DEFAULT_HEALTH_OPTIONS } from './schema';

// ============================================
// TYPE EXPORTS
// ============================================
export type { HealthOptions, HealthOptionsInput } from './schema';
