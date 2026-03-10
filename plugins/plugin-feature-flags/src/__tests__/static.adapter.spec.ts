import { StaticFeatureFlagAdapter } from '../adapters/static.adapter';
import type { FeatureFlagVariant } from '../feature-flag.types';

describe('StaticFeatureFlagAdapter', () => {
  const ctx = { userId: 'user-1', sessionId: 'session-1' };

  describe('isEnabled', () => {
    it('should return true for enabled boolean flags', async () => {
      const adapter = new StaticFeatureFlagAdapter({ 'my-flag': true });
      expect(await adapter.isEnabled('my-flag', ctx)).toBe(true);
    });

    it('should return false for disabled boolean flags', async () => {
      const adapter = new StaticFeatureFlagAdapter({ 'my-flag': false });
      expect(await adapter.isEnabled('my-flag', ctx)).toBe(false);
    });

    it('should return false for unknown flags', async () => {
      const adapter = new StaticFeatureFlagAdapter({});
      expect(await adapter.isEnabled('unknown', ctx)).toBe(false);
    });

    it('should return variant.enabled for variant flags', async () => {
      const variant: FeatureFlagVariant = { name: 'v2', value: 'new-algo', enabled: true };
      const adapter = new StaticFeatureFlagAdapter({ 'algo-flag': variant });
      expect(await adapter.isEnabled('algo-flag', ctx)).toBe(true);
    });

    it('should return false for disabled variant flags', async () => {
      const variant: FeatureFlagVariant = { name: 'off', value: undefined, enabled: false };
      const adapter = new StaticFeatureFlagAdapter({ 'algo-flag': variant });
      expect(await adapter.isEnabled('algo-flag', ctx)).toBe(false);
    });
  });

  describe('getVariant', () => {
    it('should return off variant for unknown flags', async () => {
      const adapter = new StaticFeatureFlagAdapter({});
      const result = await adapter.getVariant('unknown', ctx);
      expect(result).toEqual({ name: 'off', value: undefined, enabled: false });
    });

    it('should return on/off variant for boolean flags', async () => {
      const adapter = new StaticFeatureFlagAdapter({ 'flag-a': true, 'flag-b': false });
      expect(await adapter.getVariant('flag-a', ctx)).toEqual({ name: 'on', value: true, enabled: true });
      expect(await adapter.getVariant('flag-b', ctx)).toEqual({ name: 'off', value: false, enabled: false });
    });

    it('should return copy of variant for variant flags', async () => {
      const variant: FeatureFlagVariant = { name: 'v2', value: 'new-algo', enabled: true };
      const adapter = new StaticFeatureFlagAdapter({ 'algo-flag': variant });
      const result = await adapter.getVariant('algo-flag', ctx);
      expect(result).toEqual(variant);
      expect(result).not.toBe(variant); // should be a copy
    });
  });

  describe('evaluateFlags', () => {
    it('should batch evaluate multiple flags', async () => {
      const adapter = new StaticFeatureFlagAdapter({
        'flag-a': true,
        'flag-b': false,
        'flag-c': true,
      });
      const results = await adapter.evaluateFlags(['flag-a', 'flag-b', 'flag-c', 'unknown'], ctx);
      expect(results.get('flag-a')).toBe(true);
      expect(results.get('flag-b')).toBe(false);
      expect(results.get('flag-c')).toBe(true);
      expect(results.get('unknown')).toBe(false);
    });

    it('should return empty map for empty keys', async () => {
      const adapter = new StaticFeatureFlagAdapter({ a: true });
      const results = await adapter.evaluateFlags([], ctx);
      expect(results.size).toBe(0);
    });
  });

  describe('initialize and destroy', () => {
    it('should be no-ops', async () => {
      const adapter = new StaticFeatureFlagAdapter({});
      await expect(adapter.initialize()).resolves.toBeUndefined();
      await expect(adapter.destroy()).resolves.toBeUndefined();
    });
  });
});
