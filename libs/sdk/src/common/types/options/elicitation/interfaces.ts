// common/types/options/elicitation/interfaces.ts
// Explicit TypeScript interfaces for better IDE autocomplete
//
// These interfaces provide comprehensive JSDoc documentation and better
// IDE autocomplete experience than z.infer types. The schemas in schema.ts
// use these interfaces via RawZodShape constraint to ensure type sync.
//
// IMPORTANT: Keep these interfaces in sync with the Zod schemas.
// The typecheck.ts file will fail to compile if they get out of sync.

import type { RedisOptionsInterface } from '../redis';

// ============================================
// ELICITATION OPTIONS INTERFACE
// ============================================

/**
 * Elicitation configuration for @FrontMcp decorator.
 *
 * Elicitation allows tools and agents to request interactive user input
 * during execution. The MCP client presents a form to the user, and the
 * response is returned to the tool to continue processing.
 *
 * **When enabled:**
 * - Elicitation store is initialized (Redis or in-memory)
 * - Tool output schemas are extended to include elicitation fallback type
 * - Tools can use `this.elicit()` method to request user input
 * - `sendElicitationResult` system tool is registered for fallback support
 *
 * **When disabled (default):**
 * - No elicitation store overhead
 * - Tools calling `elicit()` throw `ElicitationDisabledError`
 * - Output schemas remain unchanged
 *
 * @example Enable with global redis
 * ```typescript
 * @FrontMcp({
 *   redis: { host: 'localhost' },
 *   elicitation: { enabled: true },
 * })
 * ```
 *
 * @example Enable with dedicated redis
 * ```typescript
 * @FrontMcp({
 *   redis: { host: 'main-redis' },
 *   elicitation: {
 *     enabled: true,
 *     redis: { host: 'elicit-redis', port: 6380 },
 *   },
 * })
 * ```
 *
 * @example Disabled (default)
 * ```typescript
 * @FrontMcp({
 *   // elicitation is disabled by default
 * })
 * ```
 */
export interface ElicitationOptionsInterface {
  /**
   * Enable elicitation support.
   *
   * When enabled, tools can request interactive user input via `this.elicit()`.
   * Requires Redis for distributed deployments; falls back to in-memory for
   * single-node development.
   *
   * @default false
   */
  enabled?: boolean;

  /**
   * Redis configuration for elicitation store.
   *
   * Use this to specify a dedicated Redis instance for elicitation state,
   * separate from the global redis used for sessions/transport.
   *
   * If not specified, falls back to the top-level `redis` configuration
   * from the `@FrontMcp` decorator.
   *
   * @example Dedicated elicitation redis
   * ```typescript
   * elicitation: {
   *   enabled: true,
   *   redis: {
   *     host: 'elicitation-redis.example.com',
   *     port: 6379,
   *     keyPrefix: 'elicit:',
   *   },
   * }
   * ```
   */
  redis?: RedisOptionsInterface;
}
