import type { FrontMcpContext } from '@frontmcp/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

/** Context passed to feature flag adapters for per-user/session evaluation. */
export interface FeatureFlagContext {
  userId?: string;
  sessionId?: string;
  attributes?: Record<string, unknown>;
}

/** Variant result from multi-variate feature flags. */
export interface FeatureFlagVariant {
  name: string;
  value: unknown;
  enabled: boolean;
}

/**
 * Metadata field type for annotating tools/resources/prompts/skills.
 * Can be a simple flag key string or an object with default value.
 */
export type FeatureFlagRef = string | { key: string; defaultValue?: boolean };

/** Cache strategy for feature flag evaluations. */
export type FeatureFlagCacheStrategy = 'session' | 'request' | 'none';

/** Resolver function for extracting user ID from context. */
export type UserIdResolver = (ctx: FrontMcpContext) => string | undefined;

/** Resolver function for extracting attributes from context. */
export type AttributesResolver = (ctx: FrontMcpContext) => Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Options (discriminated union by adapter field)
// ─────────────────────────────────────────────────────────────────────────────

/** Shared base options for all adapter configurations. */
interface FeatureFlagBaseOptions {
  /**
   * What `this.featureFlags.isEnabled()` answers when the adapter throws or has no answer for the
   * flag and the call passes no `defaultValue` of its own. Gates never read it: they use their ref's
   * `defaultValue`, then {@link gateDefaultValue}.
   * @default false
   */
  defaultValue?: boolean;
  /**
   * What a gate answers for an entry whose `featureFlag` ref sets no `defaultValue`, when the adapter
   * throws or has no answer for the flag. The gates are the `tools/call`, `resources/read`,
   * `prompts/get` and `completion/complete` checks and the list and skill filters. A ref's own
   * `defaultValue` wins over it.
   *
   * Gates fail closed by default. `true` makes every gated entry without a ref default available
   * while the flag service is down or missing a flag, so set it only when that is what you want.
   * @default false
   */
  gateDefaultValue?: boolean;
  cacheStrategy?: FeatureFlagCacheStrategy;
  cacheTtlMs?: number;
  userIdResolver?: UserIdResolver;
  attributesResolver?: AttributesResolver;
}

/** Static/in-memory flags (no external dependency). */
export interface StaticFeatureFlagPluginOptions extends FeatureFlagBaseOptions {
  adapter: 'static';
  flags: Record<string, boolean | FeatureFlagVariant>;
}

/** Split.io adapter options. */
export interface SplitioFeatureFlagPluginOptions extends FeatureFlagBaseOptions {
  adapter: 'splitio';
  config: {
    apiKey: string;
  };
}

/** LaunchDarkly adapter options. */
export interface LaunchDarklyFeatureFlagPluginOptions extends FeatureFlagBaseOptions {
  adapter: 'launchdarkly';
  config: {
    sdkKey: string;
  };
}

/** Unleash adapter options. */
export interface UnleashFeatureFlagPluginOptions extends FeatureFlagBaseOptions {
  adapter: 'unleash';
  config: {
    url: string;
    appName: string;
    apiKey?: string;
  };
}

/** Custom adapter (user provides their own implementation). */
export interface CustomFeatureFlagPluginOptions extends FeatureFlagBaseOptions {
  adapter: 'custom';
  adapterInstance: import('./adapters/feature-flag-adapter.interface').FeatureFlagAdapter;
}

/** Union of all plugin option types. */
export type FeatureFlagPluginOptions =
  | StaticFeatureFlagPluginOptions
  | SplitioFeatureFlagPluginOptions
  | LaunchDarklyFeatureFlagPluginOptions
  | UnleashFeatureFlagPluginOptions
  | CustomFeatureFlagPluginOptions;

/** Input type (same as options for this plugin). */
export type FeatureFlagPluginOptionsInput = FeatureFlagPluginOptions;

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Extension (global interface augmentation)
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface ExtendFrontMcpToolMetadata {
    featureFlag?: FeatureFlagRef;
  }
  interface ExtendFrontMcpResourceMetadata {
    featureFlag?: FeatureFlagRef;
  }
  interface ExtendFrontMcpResourceTemplateMetadata {
    featureFlag?: FeatureFlagRef;
  }
  interface ExtendFrontMcpPromptMetadata {
    featureFlag?: FeatureFlagRef;
  }
  interface ExtendFrontMcpSkillMetadata {
    featureFlag?: FeatureFlagRef;
  }
}
