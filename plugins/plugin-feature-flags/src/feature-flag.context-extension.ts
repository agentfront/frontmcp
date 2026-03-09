/**
 * Context Extension Types for FeatureFlagPlugin
 *
 * Declares TypeScript types for `this.featureFlags` property
 * on ExecutionContextBase (ToolContext, AgentContext, etc.).
 *
 * The SDK handles the runtime installation via `contextExtensions` in plugin metadata.
 * This file only provides TypeScript type augmentation.
 */

import type { FeatureFlagAccessor } from './providers/feature-flag-accessor.provider';
import { FeatureFlagAccessorToken } from './feature-flag.symbols';

// ─────────────────────────────────────────────────────────────────────────────
// Module Augmentation (TypeScript types for plugin developers)
// ─────────────────────────────────────────────────────────────────────────────

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    /**
     * Access the feature flag accessor for evaluating flags.
     * Only available when FeatureFlagPlugin is installed.
     *
     * @throws Error if FeatureFlagPlugin is not installed
     */
    readonly featureFlags: FeatureFlagAccessor;
  }

  // PromptContext doesn't extend ExecutionContextBase, so we need separate augmentation
  interface PromptContext {
    /**
     * Access the feature flag accessor for evaluating flags.
     * Only available when FeatureFlagPlugin is installed.
     */
    readonly featureFlags: FeatureFlagAccessor;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions (alternative API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the FeatureFlagAccessor from an execution context.
 * Alternative to `this.featureFlags` for explicit function-style access.
 *
 * @throws Error if FeatureFlagPlugin is not installed
 */
export function getFeatureFlags<T extends { get: (token: unknown) => unknown }>(ctx: T): FeatureFlagAccessor {
  return ctx.get(FeatureFlagAccessorToken) as FeatureFlagAccessor;
}

/**
 * Try to get the FeatureFlagAccessor, returning undefined if not available.
 * Use this for graceful degradation when the plugin might not be installed.
 */
export function tryGetFeatureFlags<T extends { tryGet?: (token: unknown) => unknown }>(
  ctx: T,
): FeatureFlagAccessor | undefined {
  if (typeof ctx.tryGet === 'function') {
    return ctx.tryGet(FeatureFlagAccessorToken) as FeatureFlagAccessor | undefined;
  }
  return undefined;
}
