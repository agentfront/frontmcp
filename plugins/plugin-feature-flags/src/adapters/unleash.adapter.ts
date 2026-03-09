import type { FeatureFlagAdapter } from './feature-flag-adapter.interface';
import type { FeatureFlagContext, FeatureFlagVariant } from '../feature-flag.types';

export interface UnleashAdapterConfig {
  url: string;
  appName: string;
  apiKey?: string;
}

/**
 * Unleash feature flag adapter.
 * Lazy-requires `unleash-client` to avoid mandatory dependency.
 */
export class UnleashFeatureFlagAdapter implements FeatureFlagAdapter {
  private readonly config: UnleashAdapterConfig;
  private client: unknown;

  constructor(config: UnleashAdapterConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    let Unleash: any;
    try {
      ({ Unleash } = require('unleash-client'));
    } catch {
      throw new Error('Unleash SDK not found. Install it: npm install unleash-client');
    }

    const options: Record<string, unknown> = {
      url: this.config.url,
      appName: this.config.appName,
    };

    if (this.config.apiKey) {
      options['customHeaders'] = { Authorization: this.config.apiKey };
    }

    this.client = new Unleash(options);
    await (this.client as any).start();
  }

  private buildUnleashContext(context: FeatureFlagContext): Record<string, unknown> {
    return {
      userId: context.userId,
      sessionId: context.sessionId,
      properties: context.attributes ?? {},
    };
  }

  async isEnabled(flagKey: string, context: FeatureFlagContext): Promise<boolean> {
    if (!this.client) throw new Error('UnleashFeatureFlagAdapter not initialized');
    const unleashCtx = this.buildUnleashContext(context);
    return (this.client as any).isEnabled(flagKey, unleashCtx);
  }

  async getVariant(flagKey: string, context: FeatureFlagContext): Promise<FeatureFlagVariant> {
    if (!this.client) throw new Error('UnleashFeatureFlagAdapter not initialized');
    const unleashCtx = this.buildUnleashContext(context);
    const variant = (this.client as any).getVariant(flagKey, unleashCtx);
    return {
      name: variant.name ?? 'disabled',
      value: variant.payload?.value ?? variant.name,
      enabled: variant.enabled ?? false,
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
      (this.client as any).destroy();
    }
    this.client = undefined;
  }
}
