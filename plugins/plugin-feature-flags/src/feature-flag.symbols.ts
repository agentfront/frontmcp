import { Reference } from '@frontmcp/sdk';
import type { FeatureFlagAdapter } from './adapters/feature-flag-adapter.interface';
import type { FeatureFlagAccessor } from './providers/feature-flag-accessor.provider';
import type { FeatureFlagPluginOptions } from './feature-flag.types';

/**
 * DI token for the feature flag adapter.
 */
export const FeatureFlagAdapterToken: Reference<FeatureFlagAdapter> = Symbol(
  'plugin:feature-flags:adapter',
) as Reference<FeatureFlagAdapter>;

/**
 * DI token for the plugin configuration.
 */
export const FeatureFlagConfigToken: Reference<FeatureFlagPluginOptions> = Symbol(
  'plugin:feature-flags:config',
) as Reference<FeatureFlagPluginOptions>;

/**
 * DI token for the context-scoped FeatureFlagAccessor.
 */
export const FeatureFlagAccessorToken: Reference<FeatureFlagAccessor> = Symbol(
  'plugin:feature-flags:accessor',
) as Reference<FeatureFlagAccessor>;
