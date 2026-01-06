// common/types/options/transport.options.ts

import { z } from 'zod';
import { redisOptionsSchema } from './redis.options';
import {
  SessionMode,
  TransportIdMode,
  PlatformMappingEntry,
  PlatformDetectionConfig,
  platformMappingEntrySchema,
  platformDetectionConfigSchema,
} from './session.options';

// Re-export session types for convenience (these are the canonical definitions)
export type { SessionMode, TransportIdMode, PlatformMappingEntry, PlatformDetectionConfig };

// ============================================
// TRANSPORT PERSISTENCE (from auth.transport.recreation)
// ============================================

/**
 * Transport persistence configuration
 * Enables session persistence to Redis/Vercel KV and automatic transport recreation after server restart.
 *
 * **Auto-enable behavior**: When top-level `redis` is configured at the `@FrontMcp` level,
 * transport persistence is automatically enabled using that configuration.
 * - To disable: explicitly set `enabled: false`
 * - To use different redis config: explicitly set `redis: {...}`
 */
export const transportPersistenceConfigSchema = z.object({
  /**
   * Enable transport persistence to Redis/Vercel KV.
   * When enabled, sessions are persisted and transports can be recreated after restart.
   *
   * **Note**: Automatically set to `true` when top-level `redis` is configured,
   * unless explicitly disabled.
   *
   * @default false (but auto-enabled when global redis is configured)
   */
  enabled: z.boolean().default(false),

  /**
   * Redis/Vercel KV configuration for session storage.
   *
   * **Auto-populated**: If omitted when `enabled: true` (or auto-enabled),
   * uses the top-level `redis` configuration from `@FrontMcp`.
   */
  redis: redisOptionsSchema.optional(),

  /**
   * Default TTL for stored session metadata (milliseconds)
   * @default 3600000 (1 hour)
   */
  defaultTtlMs: z.number().int().positive().default(3600000),
});

// ============================================
// TRANSPORT OPTIONS (unified config)
// ============================================

/**
 * Transport options schema
 * Consolidates transport protocol config + session lifecycle config
 */
export const transportOptionsSchema = z.object({
  // ============================================
  // Session Lifecycle (from session.options.ts)
  // ============================================

  /**
   * Defines how the session lifecycle and nested tokens are managed.
   *
   * Modes:
   * - `'stateful'`: Session and nested tokens are stored in a server-side store (e.g., Redis).
   * - `'stateless'`: All session data (including nested tokens) is embedded within a signed/encrypted JWT.
   *
   * @default 'stateful'
   */
  sessionMode: z
    .union([z.literal('stateful'), z.literal('stateless'), z.function()])
    .optional()
    .default('stateful'),

  /**
   * Defines how the Transport ID is generated, verified, and used across sessions.
   *
   * Modes:
   * - `'uuid'`: Generates a random UUID per session.
   * - `'jwt'`: Uses a signed JWT for stateless sessions, signed with a generated session key.
   *
   * @default 'uuid'
   */
  transportIdMode: z
    .union([z.literal('uuid'), z.literal('jwt'), z.function()])
    .optional()
    .default('uuid'),

  /**
   * Configuration for detecting the AI platform from MCP client info.
   * Allows custom mappings to override or supplement the default keyword-based detection.
   */
  platformDetection: platformDetectionConfigSchema.optional(),

  // ============================================
  // Transport Protocols (from auth.transport)
  // ============================================

  /**
   * Enable legacy SSE transport (old HTTP+SSE protocol)
   * @default false
   */
  enableLegacySSE: z.boolean().default(false),

  /**
   * Enable SSE listener for server-initiated messages (GET /mcp with Accept: text/event-stream)
   * @default true
   */
  enableSseListener: z.boolean().default(true),

  /**
   * Enable streamable HTTP transport (POST with SSE response)
   * @default true
   */
  enableStreamableHttp: z.boolean().default(true),

  /**
   * Enable stateless HTTP mode (requests without session ID)
   * When enabled, allows requests without prior initialize
   * Uses shared singleton transport for anonymous, per-token singleton for authenticated
   * @default false
   */
  enableStatelessHttp: z.boolean().default(false),

  /**
   * Enable stateful HTTP transport (JSON-only responses)
   * @default false
   */
  enableStatefulHttp: z.boolean().default(false),

  /**
   * Require session ID for streamable HTTP (non-stateless mode)
   * When false, streamable HTTP requests don't require prior initialize
   * @default true
   */
  requireSessionForStreamable: z.boolean().default(true),

  // ============================================
  // Transport Persistence
  // ============================================

  /**
   * Transport persistence configuration
   * When enabled, sessions are persisted to Redis and transports can be recreated after server restart
   */
  persistence: transportPersistenceConfigSchema.optional(),

  // ============================================
  // Distributed/Serverless Mode
  // ============================================

  /**
   * Distributed mode configuration for serverless and multi-instance deployments.
   *
   * When enabled, the SDK optimizes for environments where requests may land on
   * different server instances (e.g., Vercel, AWS Lambda, Kubernetes).
   *
   * Key behaviors when enabled:
   * - Provider session cache is disabled (CONTEXT providers rebuilt per-request)
   * - Session termination tracking uses distributed storage
   *
   * @example Auto-detect serverless environment
   * ```typescript
   * transport: {
   *   distributed: { enabled: 'auto' }
   * }
   * ```
   *
   * @example Explicit configuration
   * ```typescript
   * transport: {
   *   distributed: {
   *     enabled: true,
   *     providerCaching: false,  // Don't cache providers (default when distributed)
   *   }
   * }
   * ```
   */
  distributed: z
    .object({
      /**
       * Enable distributed mode.
       * - `true`: Always enable distributed optimizations
       * - `false`: Disable (default for traditional deployments)
       * - `'auto'`: Auto-detect serverless environment (checks VERCEL, AWS_LAMBDA_FUNCTION_NAME, etc.)
       *
       * @default false
       */
      enabled: z.union([z.boolean(), z.literal('auto')]).default(false),

      /**
       * Enable provider session caching.
       * When false, CONTEXT-scoped providers are rebuilt on each request.
       * This is the recommended setting for serverless/distributed deployments.
       *
       * @default true (but false when distributed.enabled is true/auto)
       */
      providerCaching: z.boolean().optional(),
    })
    .optional(),
});

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Transport options type (with defaults applied)
 */
export type TransportOptions = z.infer<typeof transportOptionsSchema>;

/**
 * Transport options input type (for user configuration)
 */
export type TransportOptionsInput = z.input<typeof transportOptionsSchema>;

/**
 * Transport persistence configuration type
 */
export type TransportPersistenceConfig = z.infer<typeof transportPersistenceConfigSchema>;

/**
 * Transport persistence configuration input type
 */
export type TransportPersistenceConfigInput = z.input<typeof transportPersistenceConfigSchema>;

/**
 * Platform detection configuration type
 */
export type PlatformDetectionConfigType = z.infer<typeof platformDetectionConfigSchema>;

/**
 * Distributed mode configuration type (with defaults applied)
 */
export type DistributedConfig = NonNullable<TransportOptions['distributed']>;

/**
 * Distributed mode configuration input type (for user configuration)
 */
export type DistributedConfigInput = {
  enabled?: boolean | 'auto';
  providerCaching?: boolean;
};

/**
 * Check if distributed mode is enabled based on configuration.
 * Handles 'auto' detection for serverless environments.
 */
export function isDistributedMode(config?: DistributedConfigInput): boolean {
  if (!config) return false;

  const enabled = config.enabled;
  if (enabled === true) return true;
  if (enabled === false || enabled === undefined) return false;

  // Auto-detect serverless environment
  if (enabled === 'auto') {
    // Check common serverless environment indicators
    const env = typeof process !== 'undefined' ? process.env : {};
    return !!(
      env['VERCEL'] ||
      env['NETLIFY'] ||
      env['CF_PAGES'] || // Cloudflare Pages
      env['AWS_LAMBDA_FUNCTION_NAME'] ||
      env['GOOGLE_CLOUD_PROJECT'] ||
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
export function shouldCacheProviders(config?: DistributedConfigInput): boolean {
  if (!config) return true;

  // If explicitly set, use that value
  if (config.providerCaching !== undefined) {
    return config.providerCaching;
  }

  // Default: disable caching when distributed mode is enabled
  return !isDistributedMode(config);
}
