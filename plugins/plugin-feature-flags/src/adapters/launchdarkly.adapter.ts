import type { FeatureFlagAdapter } from './feature-flag-adapter.interface';
import type { FeatureFlagContext, FeatureFlagVariant } from '../feature-flag.types';

export interface LaunchDarklyAdapterConfig {
  sdkKey: string;
}

/**
 * LaunchDarkly feature flag adapter.
 * Lazy-requires `@launchdarkly/node-server-sdk` to avoid mandatory dependency.
 */
export class LaunchDarklyFeatureFlagAdapter implements FeatureFlagAdapter {
  private readonly config: LaunchDarklyAdapterConfig;
  private client: unknown;

  constructor(config: LaunchDarklyAdapterConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    let init: any;
    try {
      ({ init } = require('@launchdarkly/node-server-sdk'));
    } catch {
      throw new Error('LaunchDarkly SDK not found. Install it: npm install @launchdarkly/node-server-sdk');
    }

    this.client = init(this.config.sdkKey);
    await (this.client as any).waitForInitialization();
  }

  private buildLDContext(context: FeatureFlagContext): Record<string, unknown> {
    return {
      kind: 'user',
      key: context.userId ?? context.sessionId ?? 'anonymous',
      ...(context.attributes ?? {}),
    };
  }

  async isEnabled(flagKey: string, context: FeatureFlagContext): Promise<boolean> {
    if (!this.client) throw new Error('LaunchDarklyFeatureFlagAdapter not initialized');
    const ldContext = this.buildLDContext(context);
    return (this.client as any).variation(flagKey, ldContext, false);
  }

  async getVariant(flagKey: string, context: FeatureFlagContext): Promise<FeatureFlagVariant> {
    if (!this.client) throw new Error('LaunchDarklyFeatureFlagAdapter not initialized');
    const ldContext = this.buildLDContext(context);
    const detail = await (this.client as any).variationDetail(flagKey, ldContext, false);
    const value = detail.value;
    return {
      name: String(value),
      value,
      enabled: Boolean(value),
    };
  }

  async evaluateFlags(flagKeys: string[], context: FeatureFlagContext): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const key of flagKeys) {
      results.set(key, await this.isEnabled(key, context));
    }
    return results;
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await (this.client as any).close();
    }
    this.client = undefined;
  }
}
