/**
 * FeatureFlagPlugin - Dynamic capability gating for FrontMCP
 *
 * Filters tools, resources, prompts, and skills based on feature flag evaluation.
 * Supports static flags, Split.io, LaunchDarkly, Unleash, and custom adapters.
 *
 * @example
 * ```typescript
 * import { FeatureFlagPlugin } from '@frontmcp/plugin-feature-flags';
 *
 * @FrontMcp({
 *   plugins: [
 *     FeatureFlagPlugin.init({
 *       adapter: 'static',
 *       flags: { 'beta-tools': true, 'experimental-agent': false },
 *     }),
 *   ],
 * })
 * class MyServer {}
 * ```
 *
 * @packageDocumentation
 */

// Main plugin (default and named)
export { default, default as FeatureFlagPlugin } from './feature-flag.plugin';

// Symbols (DI tokens)
export { FeatureFlagAdapterToken, FeatureFlagConfigToken, FeatureFlagAccessorToken } from './feature-flag.symbols';

// Types
export type {
  FeatureFlagContext,
  FeatureFlagVariant,
  FeatureFlagRef,
  FeatureFlagCacheStrategy,
  UserIdResolver,
  AttributesResolver,
  FeatureFlagPluginOptions,
  FeatureFlagPluginOptionsInput,
  StaticFeatureFlagPluginOptions,
  SplitioFeatureFlagPluginOptions,
  LaunchDarklyFeatureFlagPluginOptions,
  UnleashFeatureFlagPluginOptions,
  CustomFeatureFlagPluginOptions,
} from './feature-flag.types';

// Adapters
export type { FeatureFlagAdapter } from './adapters';
export { StaticFeatureFlagAdapter } from './adapters/static.adapter';
export { SplitioFeatureFlagAdapter } from './adapters/splitio.adapter';
export { LaunchDarklyFeatureFlagAdapter } from './adapters/launchdarkly.adapter';
export { UnleashFeatureFlagAdapter } from './adapters/unleash.adapter';

// Providers
export { FeatureFlagAccessor } from './providers/feature-flag-accessor.provider';

// Context Extension & Helpers
// TypeScript types for this.featureFlags are declared in feature-flag.context-extension.ts
// SDK handles runtime installation via contextExtensions in plugin metadata
export { getFeatureFlags, tryGetFeatureFlags } from './feature-flag.context-extension';
