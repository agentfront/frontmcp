import 'reflect-metadata';

import { DynamicPlugin, Plugin } from '../../common';
import { observabilityOptionsSchema } from '../../common/types/options/observability';
import { devEventsObservabilityConfig } from '../dev-events-observability';

@Plugin({ name: 'observability' })
class InstalledObservability extends DynamicPlugin<{ tracing?: boolean }> {}

@Plugin({ name: 'audit' })
class Audit {}

jest.mock('../optional-dependency.util', () => ({
  requireOptionalModule: () => {
    throw new Error("Cannot find module '@frontmcp/observability'");
  },
  probeOptionalDependency: () => ({ status: 'not-installed' }),
}));

describe('devEventsObservabilityConfig', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('asks for dev events only, with tracing and logging off, when frontmcp dev started the server', () => {
    process.env['FRONTMCP_DEV_EVENTS_FILE'] = '/work/.frontmcp/dev-events.jsonl';
    expect(devEventsObservabilityConfig([Audit])).toEqual({ tracing: false, logging: false });

    delete process.env['FRONTMCP_DEV_EVENTS_FILE'];
    process.env['FRONTMCP_DEV_EVENTS_IPC'] = '1';
    expect(devEventsObservabilityConfig([])).toEqual({ tracing: false, logging: false });
  });

  it('asks for nothing when the server or an app installs ObservabilityPlugin itself', () => {
    process.env['FRONTMCP_DEV_EVENTS_FILE'] = '/work/.frontmcp/dev-events.jsonl';

    expect(devEventsObservabilityConfig([Audit, InstalledObservability])).toBeUndefined();
    expect(devEventsObservabilityConfig([InstalledObservability.init({ tracing: false })])).toBeUndefined();
  });

  it('asks for nothing outside frontmcp dev', () => {
    delete process.env['FRONTMCP_DEV_EVENTS_FILE'];
    delete process.env['FRONTMCP_DEV_EVENTS_IPC'];

    expect(devEventsObservabilityConfig([])).toBeUndefined();
  });
});

describe('observabilityPlugins for the dev events frontmcp dev implies', () => {
  it('says how to get dev events when @frontmcp/observability is not installed, without a config warning', async () => {
    const { observabilityPlugins } = await import('../observability-scope.helper');
    const logger = { warn: jest.fn(), info: jest.fn(), verbose: jest.fn() };

    const plugins = observabilityPlugins({
      config: { tracing: false, logging: false },
      logger: logger as never,
      globalProviders: {} as never,
      implied: true,
    });

    expect(plugins).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'frontmcp dev writes call timings, failures and stalls to its events file with @frontmcp/observability; ' +
        'install it to get them: npm install @frontmcp/observability',
    );
  });
});

describe('observabilityOptionsSchema', () => {
  it('keeps the stalls and devEvents options for @frontmcp/observability to validate', () => {
    const parsed = observabilityOptionsSchema.parse({
      tracing: false,
      stalls: { thresholdMs: 100 },
      devEvents: { file: '.frontmcp/events.jsonl' },
    });

    expect(parsed).toEqual({
      tracing: false,
      stalls: { thresholdMs: 100 },
      devEvents: { file: '.frontmcp/events.jsonl' },
    });
    expect(observabilityOptionsSchema.parse({ stalls: true, devEvents: false })).toEqual({
      stalls: true,
      devEvents: false,
    });
  });
});
