import type { FeatureFlagAdapter } from './feature-flag-adapter.interface';
import type { FeatureFlagContext, FeatureFlagVariant } from '../feature-flag.types';

/**
 * Static/in-memory feature flag adapter.
 * Flags are defined at construction time and don't change.
 */
export class StaticFeatureFlagAdapter implements FeatureFlagAdapter {
  private readonly flags: Record<string, boolean | FeatureFlagVariant>;

  constructor(flags: Record<string, boolean | FeatureFlagVariant>) {
    this.flags = { ...flags };
  }

  async initialize(): Promise<void> {
    // No-op for static adapter
  }

  async isEnabled(flagKey: string, _context: FeatureFlagContext): Promise<boolean> {
    const flag = this.flags[flagKey];
    if (flag === undefined) return false;
    if (typeof flag === 'boolean') return flag;
    return flag.enabled;
  }

  async getVariant(flagKey: string, _context: FeatureFlagContext): Promise<FeatureFlagVariant> {
    const flag = this.flags[flagKey];
    if (flag === undefined) {
      return { name: 'off', value: undefined, enabled: false };
    }
    if (typeof flag === 'boolean') {
      return { name: flag ? 'on' : 'off', value: flag, enabled: flag };
    }
    return { ...flag };
  }

  async evaluateFlags(flagKeys: string[], context: FeatureFlagContext): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const key of flagKeys) {
      results.set(key, await this.isEnabled(key, context));
    }
    return results;
  }

  async destroy(): Promise<void> {
    // No-op for static adapter
  }
}
