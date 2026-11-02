import type { FrontMcpContext } from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import { featureFlagSource, FeatureFlagSource } from '../feature-flag.source';

function adapterAnswering(answers: Record<string, boolean>, overrides: Partial<FeatureFlagAdapter> = {}) {
  return {
    isEnabled: jest.fn(),
    getVariant: jest.fn(),
    evaluateFlags: jest.fn(
      async (keys: string[]) => new Map(keys.filter((key) => key in answers).map((key) => [key, answers[key]])),
    ),
    ...overrides,
  } as FeatureFlagAdapter & { evaluateFlags: jest.Mock };
}

describe('FeatureFlagSource', () => {
  it("answers the adapter's answer for its flag", async () => {
    const adapter = adapterAnswering({ beta: true, legacy: false });

    expect(await featureFlagSource(adapter, 'beta').get()).toBe(true);
    expect(await featureFlagSource(adapter, { key: 'legacy', defaultValue: true }).get()).toBe(false);
  });

  it('answers the ref default, then gateDefaultValue, then false for a flag the adapter does not know', async () => {
    const adapter = adapterAnswering({});

    expect(await featureFlagSource(adapter, { key: 'unknown', defaultValue: true }).get()).toBe(true);
    expect(await featureFlagSource(adapter, 'unknown', { gateDefaultValue: true }).get()).toBe(true);
    expect(await featureFlagSource(adapter, 'unknown').get()).toBe(false);
  });

  it('answers the same fallback when the adapter throws', async () => {
    const adapter = adapterAnswering({}, { evaluateFlags: jest.fn().mockRejectedValue(new Error('down')) });

    expect(await featureFlagSource(adapter, { key: 'beta', defaultValue: true }).get()).toBe(true);
    expect(await featureFlagSource(adapter, 'beta').get()).toBe(false);
  });

  it("evaluates the flag for the request's caller", async () => {
    const adapter = adapterAnswering({ beta: true });
    const context = { authInfo: { extra: { sub: 'user-7' } } } as unknown as FrontMcpContext;

    await featureFlagSource(adapter, 'beta', { attributesResolver: () => ({ plan: 'pro' }) }).get(context);

    expect(adapter.evaluateFlags).toHaveBeenCalledWith(['beta'], {
      userId: 'user-7',
      sessionId: undefined,
      attributes: { plan: 'pro' },
    });
  });

  it("follows the adapter's changes, and follows none when the adapter reports none", () => {
    const stop = jest.fn();
    const subscribe = jest.fn().mockReturnValue(stop);
    const listener = jest.fn();

    expect(featureFlagSource(adapterAnswering({}, { subscribe }), 'beta').subscribe(listener)).toBe(stop);
    expect(subscribe).toHaveBeenCalledWith(listener);
    expect(() => featureFlagSource(adapterAnswering({}), 'beta').subscribe(listener)()).not.toThrow();
  });

  it('names its flag in the remedy', () => {
    const source = new FeatureFlagSource(adapterAnswering({}), { key: 'beta' });
    expect(source.remedy).toEqual({ say: 'Turn on the feature flag "beta".' });
  });
});
