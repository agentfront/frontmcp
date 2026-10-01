/**
 * Startup and refusal errors (#660).
 *
 * - `FeatureFlagPlugin.init()` with no adapter used to start and then answer every request with
 *   500 (`Cannot resolve dependency ... from views`). It must fail at startup and name `adapter`.
 * - A flag refusal is an answer for the caller, so it is a public error with its own code.
 */
import { PublicMcpError } from '@frontmcp/sdk';

import { StaticFeatureFlagAdapter } from '../adapters/static.adapter';
import { FeatureFlagConfigurationError, FeatureFlagDisabledError } from '../feature-flag.errors';
import FeatureFlagPlugin from '../feature-flag.plugin';
import { FeatureFlagAdapterToken } from '../feature-flag.symbols';

describe('FeatureFlagPlugin startup validation', () => {
  it('rejects init() with no options and names the missing adapter', () => {
    expect(() => FeatureFlagPlugin.init()).toThrow(FeatureFlagConfigurationError);
    expect(() => FeatureFlagPlugin.init()).toThrow(/adapter/);
  });

  it('rejects an unknown adapter name and lists the supported ones', () => {
    const options = { adapter: 'nope' } as unknown as Parameters<typeof FeatureFlagPlugin.init>[0];

    expect(() => FeatureFlagPlugin.init(options)).toThrow(/"nope".*static.*splitio.*launchdarkly.*unleash.*custom/s);
  });

  it('still builds with a valid adapter', () => {
    const providers = FeatureFlagPlugin.dynamicProviders({ adapter: 'static', flags: { a: true } });

    expect(providers.find((p) => (p as { provide?: unknown }).provide === FeatureFlagAdapterToken)).toMatchObject({
      useValue: expect.any(StaticFeatureFlagAdapter),
    });
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
