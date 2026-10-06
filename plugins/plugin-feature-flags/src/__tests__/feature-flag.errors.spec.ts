/**
 * Startup and refusal errors (#660).
 *
 * - `FeatureFlagPlugin.init()` with no adapter used to start and then answer every request with
 *   500 (`Cannot resolve dependency ... from views`). It must fail at startup and name `adapter`.
 * - A flag refusal is an answer for the caller, so it is a public error with its own code.
 */
import { App, connect, LogLevel, PublicMcpError } from '@frontmcp/sdk';

import { StaticFeatureFlagAdapter } from '../adapters/static.adapter';
import { FeatureFlagConfigurationError, FeatureFlagDisabledError } from '../feature-flag.errors';
import FeatureFlagPlugin from '../feature-flag.plugin';
import { FeatureFlagAdapterToken } from '../feature-flag.symbols';

async function buildAdapter(providers: unknown[]): Promise<unknown> {
  const adapterProvider = providers.find((p) => (p as { provide?: unknown }).provide === FeatureFlagAdapterToken) as
    | { useFactory?: (scope: unknown) => Promise<unknown> }
    | undefined;
  if (!adapterProvider?.useFactory) throw new Error('no adapter factory');
  return adapterProvider.useFactory({ onDispose: jest.fn() });
}

describe('FeatureFlagPlugin startup validation', () => {
  it('rejects init() with no options and names the missing adapter', () => {
    expect(() => FeatureFlagPlugin.init()).toThrow(FeatureFlagConfigurationError);
    expect(() => FeatureFlagPlugin.init()).toThrow(/adapter/);
  });

  it('rejects an unknown adapter name and lists the supported ones', () => {
    const options = { adapter: 'nope' } as unknown as Parameters<typeof FeatureFlagPlugin.init>[0];

    expect(() => FeatureFlagPlugin.init(options)).toThrow(/"nope".*static.*splitio.*launchdarkly.*unleash.*custom/s);
  });

  describe("adapter: 'custom' (#678)", () => {
    const customOptions = (adapterInstance: unknown) =>
      ({ adapter: 'custom', adapterInstance }) as unknown as Parameters<typeof FeatureFlagPlugin.init>[0];

    it('rejects a missing adapterInstance at init and names it', () => {
      const options = { adapter: 'custom' } as unknown as Parameters<typeof FeatureFlagPlugin.init>[0];

      expect(() => FeatureFlagPlugin.init(options)).toThrow(FeatureFlagConfigurationError);
      expect(() => FeatureFlagPlugin.init(options)).toThrow(/requires an `adapterInstance` option.*got undefined/s);
    });

    it('rejects an adapterInstance that is not a feature-flag adapter and names what it lacks', () => {
      const partial = { evaluateFlags: async () => new Map<string, boolean>() };

      expect(() => FeatureFlagPlugin.init(customOptions(partial))).toThrow(FeatureFlagConfigurationError);
      expect(() => FeatureFlagPlugin.init(customOptions(partial))).toThrow(/missing isEnabled\(\), getVariant\(\)/);
      expect(() => FeatureFlagPlugin.init(customOptions('static'))).toThrow(/got "static"/);
    });

    it('rejects a missing adapterInstance at startup when the options come from useFactory', async () => {
      const plugin = FeatureFlagPlugin.init({
        inject: () => [] as const,
        useFactory: () => ({ adapter: 'custom' }) as unknown as Parameters<typeof FeatureFlagPlugin.init>[0],
      } as unknown as Parameters<typeof FeatureFlagPlugin.init>[0]);

      @App({ id: 'ff-custom-factory', name: 'Custom factory', plugins: [plugin] })
      class CustomFactoryApp {}

      await expect(
        connect({
          info: { name: 'ff-custom-factory', version: '1.0.0' },
          apps: [CustomFactoryApp],
          logging: { level: LogLevel.Off },
        }),
      ).rejects.toThrow(FeatureFlagConfigurationError);
    });

    it('builds with an adapterInstance that implements the adapter', async () => {
      const adapterInstance = new StaticFeatureFlagAdapter({ a: true });
      const providers = FeatureFlagPlugin.dynamicProviders({ adapter: 'custom', adapterInstance });

      expect(await buildAdapter(providers)).toBe(adapterInstance);
    });
  });

  it('still builds with a valid adapter', async () => {
    const providers = FeatureFlagPlugin.dynamicProviders({ adapter: 'static', flags: { a: true } });

    expect(await buildAdapter(providers)).toBeInstanceOf(StaticFeatureFlagAdapter);
  });
});

describe('FeatureFlagDisabledError', () => {
  it('is a public error with a stable code and the existing message', () => {
    const error = new FeatureFlagDisabledError('Tool', 'beta_export', 'beta-tools');

    expect(error).toBeInstanceOf(PublicMcpError);
    expect(error.message).toBe('Tool "beta_export" is disabled by feature flag "beta-tools"');
    expect(error.code).toBe('FEATURE_FLAG_DISABLED');
    expect(error.statusCode).toBe(403);
  });
});
