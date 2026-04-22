import {
  cloudAppIntegrationOptionsSchema,
  cloudAppIntegrationPolicyOptionsSchema,
  cloudAppIntegrationSyncOptionsSchema,
  cloudOptionsSchema,
} from '../schema';

describe('cloudAppIntegrationSyncOptionsSchema', () => {
  it('populates every field from an empty object', () => {
    const parsed = cloudAppIntegrationSyncOptionsSchema.parse({});
    expect(parsed).toEqual({
      mode: 'incremental',
      entryTypes: ['tool', 'resource', 'prompt', 'agent'],
      debounceMs: 150,
      batchSize: 50,
      reconcileOnStartup: true,
      deleteOnShutdown: false,
    });
  });

  it('preserves user-supplied overrides', () => {
    const parsed = cloudAppIntegrationSyncOptionsSchema.parse({
      mode: 'disabled',
      entryTypes: ['tool'],
      debounceMs: 0,
      batchSize: 1,
      reconcileOnStartup: false,
      deleteOnShutdown: true,
    });
    expect(parsed.mode).toBe('disabled');
    expect(parsed.entryTypes).toEqual(['tool']);
    expect(parsed.debounceMs).toBe(0);
    expect(parsed.batchSize).toBe(1);
    expect(parsed.reconcileOnStartup).toBe(false);
    expect(parsed.deleteOnShutdown).toBe(true);
  });

  it('rejects invalid mode values', () => {
    expect(() => cloudAppIntegrationSyncOptionsSchema.parse({ mode: 'weekly' })).toThrow();
  });

  it('rejects unknown entry types', () => {
    expect(() => cloudAppIntegrationSyncOptionsSchema.parse({ entryTypes: ['widget'] })).toThrow();
  });

  it('rejects negative debounce or batch size', () => {
    expect(() => cloudAppIntegrationSyncOptionsSchema.parse({ debounceMs: -1 })).toThrow();
    expect(() => cloudAppIntegrationSyncOptionsSchema.parse({ batchSize: 0 })).toThrow();
  });
});

describe('cloudAppIntegrationPolicyOptionsSchema', () => {
  it('fills defaults from an empty object', () => {
    const parsed = cloudAppIntegrationPolicyOptionsSchema.parse({});
    expect(parsed).toEqual({
      enforce: true,
      refreshIntervalMs: 60_000,
      onFetchFailure: 'lastKnown',
    });
  });

  it('accepts each onFetchFailure mode and preserves webhook path', () => {
    for (const mode of ['deny', 'allow', 'lastKnown'] as const) {
      const parsed = cloudAppIntegrationPolicyOptionsSchema.parse({
        onFetchFailure: mode,
        invalidateWebhookPath: '/cloud/frontegg/policies/refresh',
      });
      expect(parsed.onFetchFailure).toBe(mode);
      expect(parsed.invalidateWebhookPath).toBe('/cloud/frontegg/policies/refresh');
    }
  });

  it('rejects non-positive refresh interval', () => {
    expect(() => cloudAppIntegrationPolicyOptionsSchema.parse({ refreshIntervalMs: 0 })).toThrow();
    expect(() => cloudAppIntegrationPolicyOptionsSchema.parse({ refreshIntervalMs: -10 })).toThrow();
  });
});

describe('cloudAppIntegrationOptionsSchema', () => {
  it('defaults enabled to false and prefix to "frontmcp"', () => {
    const parsed = cloudAppIntegrationOptionsSchema.parse({});
    expect(parsed.enabled).toBe(false);
    expect(parsed.prefix).toBe('frontmcp');
    // Nested objects are intentionally left as-is (plugin parses them).
    expect(parsed.sync).toBeUndefined();
    expect(parsed.policy).toBeUndefined();
  });

  it('rejects empty prefix', () => {
    expect(() => cloudAppIntegrationOptionsSchema.parse({ prefix: '' })).toThrow();
  });

  it('passes through user-provided nested objects verbatim', () => {
    const parsed = cloudAppIntegrationOptionsSchema.parse({
      enabled: true,
      prefix: 'acme',
      sync: { mode: 'full' },
      policy: { enforce: false },
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.prefix).toBe('acme');
    expect(parsed.sync?.mode).toBe('full');
    expect(parsed.policy?.enforce).toBe(false);
  });
});

describe('cloudOptionsSchema appIntegration integration', () => {
  it('omits appIntegration entirely when unset — preserves pre-existing behavior', () => {
    const parsed = cloudOptionsSchema.parse({ clientId: 'abc', secret: 'xyz' });
    expect(parsed.appIntegration).toBeUndefined();
  });

  it('parses and defaults appIntegration when enabled', () => {
    const parsed = cloudOptionsSchema.parse({
      clientId: 'abc',
      secret: 'xyz',
      appIntegration: { enabled: true },
    });
    expect(parsed.appIntegration?.enabled).toBe(true);
    expect(parsed.appIntegration?.prefix).toBe('frontmcp');
  });
});
