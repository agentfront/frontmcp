// common/types/options/transport/schema.ts
//
// Transport configuration schema with protocol presets and simplified structure.
// Uses explicit interfaces from interfaces.ts for IDE autocomplete.

import { z } from 'zod';
import { RawZodShape } from '../../common.types';
import { redisOptionsSchema } from '../redis';

// Import types from interfaces file
// Note: SessionMode, PlatformMappingEntry, PlatformDetectionConfig
// are already exported from session.options.ts - we only import them here for internal use
import type {
  TransportOptionsInterface,
  PersistenceConfig,
  ProtocolConfig,
  ProtocolPreset,
  SessionModeOption,
  DistributedEnabled,
} from './interfaces';

// Import session types for internal use (already exported from session folder)
import type { SessionMode, PlatformDetectionConfig } from '../session';

// Re-export transport-specific types (not duplicated from session.options.ts)
export type {
  TransportOptionsInterface,
  PersistenceConfig,
  ProtocolConfig,
  ProtocolPreset,
  SessionModeOption,
  DistributedEnabled,
};

// ============================================
// PROTOCOL PRESETS
// ============================================

/**
 * Protocol preset definitions.
 *
 * Maps preset names to their expanded protocol configurations.
 */
export const PROTOCOL_PRESETS: Record<ProtocolPreset, Required<ProtocolConfig>> = {
  /**
   * Legacy (default): Modern + legacy SSE support.
   * Best for backwards compatibility with older clients.
   */
  legacy: {
    sse: true,
    streamable: true,
    json: false,
    stateless: false,
    legacy: true,
    strictSession: true,
  },

  /**
   * Modern: SSE + streamable HTTP with strict sessions.
   * Best for production deployments with session management.
   */
  modern: {
    sse: true,
    streamable: true,
    json: false,
    stateless: false,
    legacy: false,
    strictSession: true,
  },

  /**
   * Stateless API: No sessions, pure request/response.
   * Best for public APIs and serverless functions.
   */
  'stateless-api': {
    sse: false,
    streamable: false,
    json: false,
    stateless: true,
    legacy: false,
    strictSession: false,
  },

  /**
   * Full: All protocols enabled, maximum compatibility.
   * Best when supporting diverse client types.
   */
  full: {
    sse: true,
    streamable: true,
    json: true,
    stateless: true,
    legacy: true,
    strictSession: false,
  },
};

/**
 * Expand a protocol preset or config to a full ProtocolConfig with all fields.
 *
 * @param protocol - Protocol preset name or custom config
 * @returns Fully expanded protocol configuration
 *
 * @example Preset expansion
 * ```typescript
 * expandProtocolConfig('modern')
 * // { sse: true, streamable: true, json: false, stateless: false, legacy: false, strictSession: true }
 * ```
 *
 * @example Custom config with defaults
 * ```typescript
 * expandProtocolConfig({ json: true })
 * // { sse: true, streamable: true, json: true, stateless: false, legacy: false, strictSession: true }
 * ```
 */
export function expandProtocolConfig(protocol: ProtocolPreset | ProtocolConfig | undefined): Required<ProtocolConfig> {
  // Default to 'legacy' if not specified
  if (!protocol) {
    return { ...PROTOCOL_PRESETS.legacy };
  }

  // If string, use preset
  if (typeof protocol === 'string') {
    return { ...PROTOCOL_PRESETS[protocol] };
  }

  // Custom config - merge with legacy defaults
  return {
    sse: protocol.sse ?? PROTOCOL_PRESETS.legacy.sse,
    streamable: protocol.streamable ?? PROTOCOL_PRESETS.legacy.streamable,
    json: protocol.json ?? PROTOCOL_PRESETS.legacy.json,
    stateless: protocol.stateless ?? PROTOCOL_PRESETS.legacy.stateless,
    legacy: protocol.legacy ?? PROTOCOL_PRESETS.legacy.legacy,
    strictSession: protocol.strictSession ?? PROTOCOL_PRESETS.legacy.strictSession,
  };
}

// ============================================
// INTERNAL LEGACY FLAG CONVERSION
// ============================================

/**
 * Internal configuration format compatible with decide-request-intent.utils.ts
 * @internal
 */
export interface LegacyProtocolFlags {
  enableLegacySSE: boolean;
  enableSseListener: boolean;
  enableStreamableHttp: boolean;
  enableStatelessHttp: boolean;
  enableStatefulHttp: boolean;
  requireSessionForStreamable: boolean;
}

/**
 * Convert protocol config to legacy boolean flags.
 * Used internally to maintain compatibility with decision logic.
 * @internal
 */
export function toLegacyProtocolFlags(protocol: ProtocolPreset | ProtocolConfig | undefined): LegacyProtocolFlags {
  const expanded = expandProtocolConfig(protocol);
  return {
    enableLegacySSE: expanded.legacy,
    enableSseListener: expanded.sse,
    enableStreamableHttp: expanded.streamable,
    enableStatelessHttp: expanded.stateless,
    enableStatefulHttp: expanded.json,
    requireSessionForStreamable: expanded.strictSession,
  };
}

// ============================================
// PLATFORM DETECTION SCHEMAS
// ============================================

// Note: platformMappingEntrySchema and platformDetectionConfigSchema
// are already exported from session folder - import for internal use
import { platformDetectionConfigSchema } from '../session';

// ============================================
// PROTOCOL CONFIG SCHEMA
// ============================================

const protocolConfigSchema = z.object({
  sse: z.boolean().optional(),
  streamable: z.boolean().optional(),
  json: z.boolean().optional(),
  stateless: z.boolean().optional(),
  legacy: z.boolean().optional(),
  strictSession: z.boolean().optional(),
});

const protocolPresetSchema = z.enum(['modern', 'legacy', 'stateless-api', 'full']);

const protocolSchema = z.union([protocolPresetSchema, protocolConfigSchema]);

// ============================================
// PERSISTENCE CONFIG SCHEMA (SIMPLIFIED)
// ============================================

/**
 * Simplified persistence config - no explicit 'enabled' flag.
 * - `false`: Explicitly disable persistence
 * - `object`: Enable with custom config
 * - `undefined`: Auto-enable when global redis exists
 */
export const persistenceConfigSchema = z.object({
  redis: redisOptionsSchema.optional(),
  defaultTtlMs: z.number().int().positive().default(3600000),
});

// ============================================
// TRANSPORT OPTIONS SCHEMA
// ============================================

/**
 * Transport options schema - the canonical Zod schema for transport configuration.
 *
 * Uses the TransportOptionsInterface for type sync validation.
 */
export const transportOptionsSchema = z.object({
  // ============================================
  // Session Lifecycle
  // ============================================

  sessionMode: z
    .union([z.literal('stateful'), z.literal('stateless'), z.function()])
    .optional()
    .default('stateful'),

  platformDetection: platformDetectionConfigSchema.optional(),

  // ============================================
  // Protocol Configuration (NEW)
  // ============================================

  protocol: protocolSchema.optional().default('legacy'),

  // ============================================
  // Persistence Configuration (SIMPLIFIED)
  // ============================================

  persistence: z.union([z.literal(false), persistenceConfigSchema]).optional(),

  // ============================================
  // Distributed Mode (FLATTENED)
  // ============================================

  distributedMode: z
    .union([z.boolean(), z.literal('auto')])
    .optional()
    .default(false),

  providerCaching: z.boolean().optional(),
} satisfies RawZodShape<TransportOptionsInterface>);

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Transport options type (with defaults applied).
 * This is the output type after Zod parsing.
 */
export type TransportOptions = z.infer<typeof transportOptionsSchema>;

/**
 * Transport options input type (for user configuration).
 * Uses the explicit interface for better IDE autocomplete.
 */
export type TransportOptionsInput = TransportOptionsInterface;

/**
 * Persistence configuration type (with defaults applied)
 */
export type TransportPersistenceConfig = z.infer<typeof persistenceConfigSchema>;

/**
 * Persistence configuration input type
 */
export type TransportPersistenceConfigInput = z.input<typeof persistenceConfigSchema>;

/**
 * Platform detection configuration type
 */
export type PlatformDetectionConfigType = z.infer<typeof platformDetectionConfigSchema>;

// ============================================
// DISTRIBUTED MODE HELPERS
// ============================================

/**
 * Distributed mode configuration input type (for user configuration)
 */
export type DistributedConfigInput = {
  enabled?: DistributedEnabled;
  providerCaching?: boolean;
};

/**
 * Check if distributed mode is enabled based on configuration.
 * Handles 'auto' detection for serverless environments.
 */
export function isDistributedMode(distributedMode?: DistributedEnabled): boolean {
  if (distributedMode === true) return true;
  if (distributedMode === false || distributedMode === undefined) return false;

  // Auto-detect serverless environment
  if (distributedMode === 'auto') {
    // Check common serverless environment indicators
    const env = typeof process !== 'undefined' ? process.env : {};
    return !!(
      env['VERCEL'] ||
      env['NETLIFY'] ||
      env['CF_PAGES'] || // Cloudflare Pages
      env['AWS_LAMBDA_FUNCTION_NAME'] ||
      env['AZURE_FUNCTIONS_ENVIRONMENT'] ||
      env['K_SERVICE'] || // Google Cloud Run
      env['RAILWAY_ENVIRONMENT'] ||
      env['RENDER'] ||
      env['FLY_APP_NAME']
    );
  }

  return false;
}

/**
 * Get effective provider caching setting based on distributed config.
 */
export function shouldCacheProviders(distributedMode?: DistributedEnabled, providerCaching?: boolean): boolean {
  // If explicitly set, use that value
  if (providerCaching !== undefined) {
    return providerCaching;
  }

  // Default: disable caching when distributed mode is enabled
  return !isDistributedMode(distributedMode);
}

// ============================================
// TRANSPORT CONFIG EXPANSION FOR INTERNAL USE
// ============================================

/**
 * Expanded transport configuration for internal use.
 * Contains legacy boolean flags for backward compatibility with internal code.
 * @internal
 */
export interface ExpandedTransportConfig extends LegacyProtocolFlags {
  sessionMode: SessionMode | ((issuer: string) => Promise<SessionMode> | SessionMode);
  platformDetection?: PlatformDetectionConfig;
  persistence?: false | TransportPersistenceConfig;
  distributedMode: DistributedEnabled;
  providerCaching?: boolean;
}

/**
 * Expand transport options to include legacy boolean flags.
 * Used internally to maintain compatibility with decision logic.
 * @internal
 */
export function expandTransportConfig(config: TransportOptions): ExpandedTransportConfig {
  const legacyFlags = toLegacyProtocolFlags(config.protocol);

  // Cast sessionMode since z.function() infers a different type than our explicit interfaces
  // At runtime, both the literal and function variants are valid
  return {
    sessionMode: config.sessionMode as ExpandedTransportConfig['sessionMode'],
    platformDetection: config.platformDetection,
    persistence: config.persistence,
    distributedMode: config.distributedMode,
    providerCaching: config.providerCaching,
    ...legacyFlags,
  };
}
