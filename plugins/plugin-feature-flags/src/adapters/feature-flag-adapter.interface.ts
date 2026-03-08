import type { FeatureFlagContext, FeatureFlagVariant } from '../feature-flag.types';

/**
 * Unified interface for feature flag adapters.
 * All adapters (static, Split.io, LaunchDarkly, Unleash, custom) implement this.
 */
export interface FeatureFlagAdapter {
  /** Initialize the adapter (connect to service, etc.). */
  initialize(): Promise<void>;

  /** Check if a flag is enabled for the given context. */
  isEnabled(flagKey: string, context: FeatureFlagContext): Promise<boolean>;

  /** Get the variant for a flag (for multi-variate flags). */
  getVariant(flagKey: string, context: FeatureFlagContext): Promise<FeatureFlagVariant>;

  /** Batch evaluate multiple flags at once. */
  evaluateFlags(flagKeys: string[], context: FeatureFlagContext): Promise<Map<string, boolean>>;

  /** Destroy the adapter (disconnect, cleanup). */
  destroy(): Promise<void>;
}
