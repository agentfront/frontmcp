// common/types/options/transport/interfaces.ts
// Explicit TypeScript interfaces for better IDE autocomplete
//
// These interfaces provide comprehensive JSDoc documentation and better
// IDE autocomplete experience than z.infer types. The schemas in schema.ts
// use these interfaces via RawZodShape constraint to ensure type sync.
//
// IMPORTANT: Keep these interfaces in sync with the Zod schemas.
// The typecheck.ts file will fail to compile if they get out of sync.

import type { RedisOptionsInput } from '../redis';

// Import session types from session folder (these are the canonical definitions)
import type { SessionMode, PlatformMappingEntry, PlatformDetectionConfig } from '../session';

// Re-export for convenience
export type { SessionMode, PlatformMappingEntry, PlatformDetectionConfig };

// ============================================
// SESSION MODE OPTION TYPES
// ============================================

/**
 * Session mode option - can be a literal or a function for dynamic selection.
 *
 * When a function is provided, it receives the issuer string and can return
 * the mode synchronously or asynchronously.
 *
 * @example Static mode
 * ```typescript
 * sessionMode: 'stateful'
 * ```
 *
 * @example Dynamic mode based on issuer
 * ```typescript
 * sessionMode: (issuer) => issuer.includes('google') ? 'stateless' : 'stateful'
 * ```
 */
export type SessionModeOption = SessionMode | ((issuer: string) => Promise<SessionMode> | SessionMode);

// ============================================
// PROTOCOL CONFIGURATION TYPES
// ============================================

/**
 * Protocol preset names for simplified configuration.
 *
 * Presets provide sensible defaults for common deployment scenarios:
 *
 * - `'legacy'` (default): Modern + legacy SSE support.
 *   Best for backwards compatibility with older clients.
 *
 * - `'modern'`: SSE + streamable HTTP with strict sessions.
 *   Best for production deployments with session management.
 *
 * - `'stateless-api'`: No sessions, pure request/response.
 *   Best for public APIs and serverless functions.
 *
 * - `'full'`: All protocols enabled, maximum compatibility.
 *   Best when supporting diverse client types.
 */
export type ProtocolPreset = 'modern' | 'legacy' | 'stateless-api' | 'full';

/**
 * Granular protocol configuration.
 *
 * Use this instead of presets when you need fine-grained control
 * over which transport protocols are enabled.
 *
 * @example Enable JSON responses for testing
 * ```typescript
 * protocol: {
 *   sse: true,
 *   streamable: true,
 *   json: true,  // Enable JSON-only responses
 *   strictSession: true,
 * }
 * ```
 */
export interface ProtocolConfig {
  /**
   * Enable SSE listener for server-initiated messages.
   * Handles GET requests with `Accept: text/event-stream` header.
   * @default true
   */
  sse?: boolean;

  /**
   * Enable streamable HTTP transport (POST with SSE response).
   * This is the recommended transport for production use.
   * @default true
   */
  streamable?: boolean;

  /**
   * Enable JSON-only responses (stateful HTTP).
   * Useful for development and debugging.
   * @default false
   */
  json?: boolean;

  /**
   * Enable stateless HTTP mode (requests without session ID).
   * When enabled, allows requests without prior initialize.
   * @default false
   */
  stateless?: boolean;

  /**
   * Enable legacy SSE transport (old HTTP+SSE protocol).
   * Enable for backwards compatibility with older clients.
   * @default false
   */
  legacy?: boolean;

  /**
   * Require session ID for streamable HTTP (non-stateless mode).
   * When false, streamable HTTP requests don't require prior initialize.
   * @default true
   */
  strictSession?: boolean;
}

// ============================================
// PERSISTENCE CONFIGURATION TYPES
// ============================================

/**
 * Transport persistence configuration.
 *
 * Enables session persistence to Redis/Vercel KV for transport recreation
 * after server restart. This is essential for serverless deployments.
 *
 * **Auto-enable behavior**: When top-level `redis` is configured at the
 * `@FrontMcp` level, transport persistence is automatically enabled.
 * Set `persistence: false` to explicitly disable.
 *
 * @example Use global redis (auto-configured)
 * ```typescript
 * // At @FrontMcp level:
 * redis: { host: 'localhost' },
 * // persistence auto-enabled using global redis
 * ```
 *
 * @example Override with custom config
 * ```typescript
 * transport: {
 *   persistence: {
 *     redis: { host: 'different-host' },
 *     defaultTtlMs: 7200000,  // 2 hours
 *   },
 * }
 * ```
 *
 * @example Explicitly disable
 * ```typescript
 * transport: {
 *   persistence: false,
 * }
 * ```
 */
export interface PersistenceConfig {
  /**
   * Redis/Vercel KV configuration for session storage.
   *
   * If omitted, uses the top-level `redis` configuration from `@FrontMcp`.
   */
  redis?: RedisOptionsInput;

  /**
   * Default TTL for stored session metadata (milliseconds).
   * @default 3600000 (1 hour)
   */
  defaultTtlMs?: number;
}

// ============================================
// DISTRIBUTED MODE TYPES
// ============================================

/**
 * Distributed mode enabled setting.
 *
 * - `true`: Always enable distributed optimizations
 * - `false`: Disable (default for traditional deployments)
 * - `'auto'`: Auto-detect serverless environment
 *
 * Auto-detection checks for environment variables:
 * - `VERCEL`
 * - `NETLIFY`
 * - `CF_PAGES` (Cloudflare Pages)
 * - `AWS_LAMBDA_FUNCTION_NAME`
 * - `AZURE_FUNCTIONS_ENVIRONMENT`
 * - `K_SERVICE` (Google Cloud Run)
 * - `RAILWAY_ENVIRONMENT`
 * - `RENDER`
 * - `FLY_APP_NAME`
 */
export type DistributedEnabled = boolean | 'auto';

// ============================================
// MAIN TRANSPORT OPTIONS INTERFACE
// ============================================

/**
 * Transport and session lifecycle configuration for FrontMCP.
 *
 * This interface provides the canonical configuration surface for all
 * transport-related settings, consolidating protocol config, session
 * lifecycle, persistence, and distributed mode.
 *
 * @example Basic configuration (uses defaults)
 * ```typescript
 * transport: {}  // Uses 'modern' preset
 * ```
 *
 * @example Legacy setup (backwards compatible)
 * ```typescript
 * transport: {
 *   protocol: 'legacy',
 * }
 * ```
 *
 * @example Production with persistence
 * ```typescript
 * redis: { host: 'redis.example.com' },
 * transport: {
 *   protocol: 'modern',
 *   // persistence auto-enabled
 * }
 * ```
 *
 * @example Serverless deployment
 * ```typescript
 * redis: { provider: 'vercel-kv' },
 * transport: {
 *   protocol: 'stateless-api',
 *   distributedMode: 'auto',
 * }
 * ```
 *
 * @example Custom protocol configuration
 * ```typescript
 * transport: {
 *   protocol: {
 *     sse: true,
 *     streamable: true,
 *     json: true,
 *     stateless: false,
 *     legacy: false,
 *     strictSession: true,
 *   },
 * }
 * ```
 */
export interface TransportOptionsInterface {
  // ============================================
  // Session Lifecycle
  // ============================================

  /**
   * Defines how the session lifecycle and nested tokens are managed.
   *
   * Modes:
   * - `'stateful'`: Session and nested tokens are stored server-side (e.g., Redis).
   *   Results in smaller JWTs and supports token refresh.
   * - `'stateless'`: All session data is embedded in the JWT.
   *   Simpler but doesn't support token refresh.
   *
   * Can be a function for dynamic selection based on issuer.
   *
   * @default 'stateful'
   */
  sessionMode?: SessionModeOption;

  /**
   * Configuration for detecting the AI platform from MCP client info.
   */
  platformDetection?: PlatformDetectionConfig;

  // ============================================
  // Protocol Configuration
  // ============================================

  /**
   * Protocol configuration - use a preset or customize individual settings.
   *
   * **Presets:**
   * - `'legacy'` (default): Modern + legacy SSE support
   * - `'modern'`: SSE + streamable HTTP, strict sessions
   * - `'stateless-api'`: No sessions, pure request/response
   * - `'full'`: All protocols enabled
   *
   * @default 'legacy'
   */
  protocol?: ProtocolPreset | ProtocolConfig;

  // ============================================
  // Persistence Configuration
  // ============================================

  /**
   * Transport persistence configuration.
   *
   * When enabled, sessions are persisted to Redis/Vercel KV and transports
   * can be recreated after server restart.
   *
   * **Auto-enable behavior**: Automatically enabled when top-level `redis`
   * is configured, unless explicitly disabled.
   *
   * - `false`: Explicitly disable persistence
   * - `object`: Enable with custom config (redis override, TTL)
   * - `undefined`: Auto-enable when global redis exists
   */
  persistence?: false | PersistenceConfig;

  // ============================================
  // Distributed Mode
  // ============================================

  /**
   * Enable distributed mode for serverless/multi-instance deployments.
   *
   * When enabled, the SDK optimizes for environments where requests may
   * land on different server instances.
   *
   * - `true`: Always enable distributed optimizations
   * - `false`: Disable (default)
   * - `'auto'`: Auto-detect serverless environment
   *
   * @default false
   */
  distributedMode?: DistributedEnabled;

  /**
   * Enable provider session caching.
   *
   * When false, CONTEXT-scoped providers are rebuilt on each request.
   * Automatically disabled when `distributedMode` is enabled.
   *
   * @default true (false when distributedMode is enabled)
   */
  providerCaching?: boolean;
}

// ============================================
// TYPE EXPORTS FOR CONVENIENCE
// ============================================

/**
 * Transport options input type - uses this explicit interface for IDE autocomplete.
 * This is the type users should use when configuring transport options.
 */
export type TransportOptionsInput = TransportOptionsInterface;
