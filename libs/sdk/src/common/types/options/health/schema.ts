// common/types/options/health/schema.ts
//
// Health and readiness endpoint configuration schema for @FrontMcp decorator.
// Uses explicit interfaces from interfaces.ts for IDE autocomplete.

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';
import type { HealthOptionsInterface, HealthReadyzOptionsInterface } from './interfaces';

// Re-export interface types for convenience
export type { HealthOptionsInterface, HealthReadyzOptionsInterface };

// ============================================
// READYZ OPTIONS SCHEMA
// ============================================

/**
 * Zod schema for readiness probe sub-configuration.
 */
export const healthReadyzOptionsSchema = z.object({
  enabled: z.boolean().optional(),
  timeoutMs: z.number().positive().optional().default(5000),
} satisfies RawZodShape<HealthReadyzOptionsInterface>);

// ============================================
// HEALTH OPTIONS SCHEMA
// ============================================

/**
 * Zod schema for health endpoint configuration.
 *
 * Validates and provides defaults for health options.
 * See `HealthOptionsInterface` for full documentation.
 */
export const healthOptionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  healthzPath: z.string().optional().default('/healthz'),
  readyzPath: z.string().optional().default('/readyz'),
  probes: z.array(z.any()).optional().default([]),
  includeDetails: z.boolean().optional(),
  readyz: healthReadyzOptionsSchema.optional(),
} satisfies RawZodShape<HealthOptionsInterface>);

// ============================================
// DEFAULT VALUES
// ============================================

/**
 * Default health configuration values.
 *
 * Health endpoints are enabled by default with standard Kubernetes paths.
 */
export const DEFAULT_HEALTH_OPTIONS: Pick<
  Required<HealthOptionsInterface>,
  'enabled' | 'healthzPath' | 'readyzPath'
> = {
  enabled: true,
  healthzPath: '/healthz',
  readyzPath: '/readyz',
};

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Health options type (with defaults applied).
 *
 * This is the type of health config after Zod parsing,
 * with all defaults applied.
 */
export type HealthOptions = z.infer<typeof healthOptionsSchema>;

/**
 * Health options input type (for user configuration).
 * Uses explicit interface for better IDE autocomplete.
 */
export type HealthOptionsInput = HealthOptionsInterface;
