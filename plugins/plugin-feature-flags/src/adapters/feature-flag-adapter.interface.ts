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

  /**
   * Batch evaluate multiple flags at once.
   *
   * An adapter MAY omit a key it has no opinion on — a flag it has never heard of. An absent
   * key means "unknown", and the caller applies the ref's `defaultValue`; a key present with
   * `false` means the flag is genuinely disabled and `defaultValue` does NOT apply. Conflating
   * the two makes `defaultValue` dead code and makes listing disagree with the execution gate.
   *
   * Adapters backed by a remote service (Split.io, LaunchDarkly, Unleash) always have an
   * opinion, because the service applies its own default — they answer for every key.
   */
  evaluateFlags(flagKeys: string[], context: FeatureFlagContext): Promise<Map<string, boolean>>;

  /** Destroy the adapter (disconnect, cleanup). */
  destroy(): Promise<void>;
}
