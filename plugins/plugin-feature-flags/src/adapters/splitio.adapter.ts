import type { FeatureFlagContext, FeatureFlagVariant } from '../feature-flag.types';
import type { FeatureFlagAdapter } from './feature-flag-adapter.interface';

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

  /** Follows the client's `SDK_UPDATE` events, which fire when the definitions it fetched change. */
  subscribe(listener: () => void): () => void {
    const client = this.client as {
      Event: { SDK_UPDATE: string };
      on(event: string, fn: () => void): void;
      off(event: string, fn: () => void): void;
    };
    if (!client) return () => undefined;
    const event = client.Event.SDK_UPDATE;
    client.on(event, listener);
    return () => client.off(event, listener);
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await (this.client as any).destroy();
    }
    this.client = undefined;
    this.factory = undefined;
  }
}
