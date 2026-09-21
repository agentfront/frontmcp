import { FrontMcpContext, Provider, ProviderScope } from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import { buildFeatureFlagContext } from '../feature-flag.context';
import type {
  FeatureFlagContext,
  FeatureFlagPluginOptions,
  FeatureFlagRef,
  FeatureFlagVariant,
} from '../feature-flag.types';

/**
 * Context-scoped accessor for feature flag evaluation.
 * Provides caching and context resolution from FrontMcpContext.
 */
@Provider({
  name: 'provider:feature-flags:accessor',
  description: 'Context-scoped accessor for feature flag evaluation',
  scope: ProviderScope.CONTEXT,
})
export class FeatureFlagAccessor {
  private readonly adapter: FeatureFlagAdapter;
  private readonly ctx: FrontMcpContext;
  private readonly config: FeatureFlagPluginOptions;
  private readonly cache = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(adapter: FeatureFlagAdapter, ctx: FrontMcpContext, config: FeatureFlagPluginOptions) {
    this.adapter = adapter;
    this.ctx = ctx;
    this.config = config;
  }

  /**
   * Check if a feature flag is enabled.
   */
  async isEnabled(flagKey: string, defaultValue?: boolean): Promise<boolean> {
    const cacheStrategy = this.config.cacheStrategy ?? 'none';
    const cacheTtlMs = this.config.cacheTtlMs ?? 30_000;

    // Check cache
    if (cacheStrategy !== 'none') {
      const cached = this.cache.get(flagKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
      }
    }

    const context = this.buildContext();
    let result: boolean;
    try {
      result = await this.adapter.isEnabled(flagKey, context);
    } catch {
      result = defaultValue ?? this.config.defaultValue ?? false;
    }

    // Store in cache
    if (cacheStrategy !== 'none') {
      this.cache.set(flagKey, { value: result, expiresAt: Date.now() + cacheTtlMs });
    }

    return result;
  }

  /**
   * Get a feature flag variant (for multi-variate flags).
   */
  async getVariant(flagKey: string): Promise<FeatureFlagVariant> {
    const context = this.buildContext();
    return this.adapter.getVariant(flagKey, context);
  }

  /**
   * Batch evaluate multiple flags at once.
   */
  async evaluateFlags(flagKeys: string[]): Promise<Map<string, boolean>> {
    const context = this.buildContext();
    return this.adapter.evaluateFlags(flagKeys, context);
  }

  /**
   * Resolve a FeatureFlagRef (string or object) to a boolean.
   */
  async resolveRef(ref: FeatureFlagRef): Promise<boolean> {
    if (typeof ref === 'string') {
      return this.isEnabled(ref);
    }
    return this.isEnabled(ref.key, ref.defaultValue);
  }

  /**
   * Build the FeatureFlagContext from the current FrontMcpContext.
   */
  private buildContext(): FeatureFlagContext {
    return buildFeatureFlagContext(this.ctx, this.config);
  }
}

/**
 * Factory function for creating FeatureFlagAccessor instances.
 */
export function createFeatureFlagAccessor(
  adapter: FeatureFlagAdapter,
  ctx: FrontMcpContext,
  config: FeatureFlagPluginOptions,
): FeatureFlagAccessor {
  return new FeatureFlagAccessor(adapter, ctx, config);
}
