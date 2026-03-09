import type { FeatureFlagAdapter } from './feature-flag-adapter.interface';
import type { FeatureFlagContext, FeatureFlagVariant } from '../feature-flag.types';

export interface SplitioAdapterConfig {
  apiKey: string;
}

/**
 * Split.io feature flag adapter.
 * Lazy-requires `@splitsoftware/splitio` to avoid mandatory dependency.
 */
export class SplitioFeatureFlagAdapter implements FeatureFlagAdapter {
  private readonly config: SplitioAdapterConfig;
  private factory: unknown;
  private client: unknown;

  constructor(config: SplitioAdapterConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Lazy-require to avoid bundling dependency
    let SplitFactory: any;
    try {
      ({ SplitFactory } = require('@splitsoftware/splitio'));
    } catch {
      throw new Error('Split.io SDK not found. Install it: npm install @splitsoftware/splitio');
    }

    this.factory = SplitFactory({
      core: {
        authorizationKey: this.config.apiKey,
      },
    });

    this.client = (this.factory as any).client();
    await (this.client as any).ready();
  }

  async isEnabled(flagKey: string, context: FeatureFlagContext): Promise<boolean> {
    if (!this.client) throw new Error('SplitioFeatureFlagAdapter not initialized');
    const key = context.userId ?? context.sessionId ?? 'anonymous';
    const treatment = (this.client as any).getTreatment(key, flagKey, context.attributes);
    return treatment === 'on';
  }

  async getVariant(flagKey: string, context: FeatureFlagContext): Promise<FeatureFlagVariant> {
    if (!this.client) throw new Error('SplitioFeatureFlagAdapter not initialized');
    const key = context.userId ?? context.sessionId ?? 'anonymous';
    const treatment = (this.client as any).getTreatment(key, flagKey, context.attributes);
    return {
      name: treatment,
      value: treatment,
      enabled: treatment === 'on',
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
      await (this.client as any).destroy();
    }
    this.client = undefined;
    this.factory = undefined;
  }
}
