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
  /** The adapter's answers by flag key: `undefined` when it has none (an unknown flag). */
  private readonly cache = new Map<string, { answer: boolean | undefined; expiresAt: number }>();

  constructor(adapter: FeatureFlagAdapter, ctx: FrontMcpContext, config: FeatureFlagPluginOptions) {
    this.adapter = adapter;
    this.ctx = ctx;
    this.config = config;
  }

  /**
   * Check if a feature flag is enabled.
   *
   * `defaultValue` (else the plugin's `defaultValue`, else `false`) is the answer when the adapter
   * throws or has no answer for the flag: a key the static adapter was not given, or one a custom
   * adapter's `evaluateFlags()` omits. A flag the adapter answers keeps its answer, `false` included.
   * It used to apply only when the adapter threw, so `isEnabled('unknown', true)` was `false` (#678).
   */
  async isEnabled(flagKey: string, defaultValue?: boolean): Promise<boolean> {
    const answer = await this.evaluate(flagKey);
    return answer ?? defaultValue ?? this.config.defaultValue ?? false;
  }

  /**
   * The adapter's answer for one flag, or `undefined` when it has none or throws. Asked through
   * `evaluateFlags()`, as the execution gates ask, which is how an adapter says it does not know a
   * flag; `isEnabled()` answers `false` for it. A successful answer is cached per `cacheStrategy`.
   */
  private async evaluate(flagKey: string): Promise<boolean | undefined> {
    const cacheStrategy = this.config.cacheStrategy ?? 'none';
    const cacheTtlMs = this.config.cacheTtlMs ?? 30_000;

    if (cacheStrategy !== 'none') {
      const cached = this.cache.get(flagKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.answer;
      }
    }

    let answer: boolean | undefined;
    try {
      const results = await this.adapter.evaluateFlags([flagKey], this.buildContext());
      answer = results.has(flagKey) ? results.get(flagKey) === true : undefined;
    } catch {
      // An adapter error is not an answer: the caller's default applies, and nothing is cached.
      return undefined;
    }

    if (cacheStrategy !== 'none') {
      this.cache.set(flagKey, { answer, expiresAt: Date.now() + cacheTtlMs });
    }
    return answer;
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
