/**
 * Rate Limiting, Concurrency Control & Timeout
 *
 * Re-exports from @frontmcp/guard library.
 * SDK-specific adapters (e.g., ThrottleConfig alias) kept here.
 */

export * from '@frontmcp/guard';

/**
 * SDK-specific alias: ThrottleConfig is GuardConfig in the guard library.
 * Kept for backward compatibility with @FrontMcp({ throttle: ... }) config.
 */
export type { GuardConfig as ThrottleConfig } from '@frontmcp/guard';
