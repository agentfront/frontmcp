import { mergeCloudContributions } from '../merge';

describe('mergeCloudContributions', () => {
  it('returns userMetadata unchanged when contributions is undefined', () => {
    const user = { plugins: ['a'] };
    expect(mergeCloudContributions(user, undefined)).toBe(user);
  });

  it('appends cloud plugins/providers/tools additively', () => {
    const user = { plugins: ['u1'], tools: ['t1'] };
    const merged = mergeCloudContributions(user, {
      plugins: ['c1'],
      tools: ['t2'],
      providers: ['p1'],
    });
    expect(merged.plugins).toEqual(['u1', 'c1']);
    expect(merged.tools).toEqual(['t1', 't2']);
    expect(merged.providers).toEqual(['p1']);
  });

  it('does not mutate the input', () => {
    const user: Record<string, unknown> = { plugins: ['u1'] };
    mergeCloudContributions(user, { plugins: ['c1'] });
    expect(user.plugins).toEqual(['u1']);
  });

  it('applies override strategy — cloud value wins', () => {
    const merged = mergeCloudContributions(
      { cors: { origin: 'https://user.example' } },
      {
        optionsOverride: {
          cors: { strategy: 'override', value: { origin: 'https://cloud.example' } },
        },
      },
    );
    expect(merged.cors).toEqual({ origin: 'https://cloud.example' });
  });

  it('applies fillGaps strategy — user wins when set, cloud fills when absent', () => {
    const mergedWithUser = mergeCloudContributions(
      { cors: { origin: 'https://user.example' } },
      {
        optionsOverride: {
          cors: { strategy: 'fillGaps', value: { origin: 'https://cloud.example' } },
        },
      },
    );
    expect(mergedWithUser.cors).toEqual({ origin: 'https://user.example' });

    const mergedWithoutUser = mergeCloudContributions(
      {},
      {
        optionsOverride: {
          cors: { strategy: 'fillGaps', value: { origin: 'https://cloud.example' } },
        },
      },
    );
    expect(mergedWithoutUser.cors).toEqual({ origin: 'https://cloud.example' });
  });

  it('applies additive strategy — arrays concat, objects shallow-merge with user wins', () => {
    const merged = mergeCloudContributions(
      { featureFlags: { a: true, b: false } },
      {
        optionsOverride: {
          featureFlags: { strategy: 'additive', value: { b: true, c: true } },
        },
      },
    );
    // User keys preserved (b stays false), new cloud keys added (c: true).
    expect(merged.featureFlags).toEqual({ a: true, b: false, c: true });
  });

  it('additive strategy concats arrays', () => {
    const merged = mergeCloudContributions(
      { origins: ['https://a'] },
      {
        optionsOverride: {
          origins: { strategy: 'additive', value: ['https://b', 'https://c'] },
        },
      },
    );
    expect(merged.origins).toEqual(['https://a', 'https://b', 'https://c']);
  });

  it('unknown strategy falls back to fillGaps', () => {
    const merged = mergeCloudContributions(
      {},
      {
        optionsOverride: {
          foo: { strategy: 'bogus' as unknown as 'fillGaps', value: 'cloudValue' },
        },
      },
    );
    expect(merged.foo).toBe('cloudValue');
  });
});
