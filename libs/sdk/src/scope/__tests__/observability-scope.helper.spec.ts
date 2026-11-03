import 'reflect-metadata';

import { InternalMcpError } from '../../errors';
import { observabilityPlugins } from '../observability-scope.helper';

class ObservabilityConfigurationError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'OBSERVABILITY_CONFIGURATION');
  }
}

const init = jest.fn();

jest.mock('../optional-dependency.util', () => ({
  requireOptionalModule: () => ({ ObservabilityPlugin: { init } }),
  probeOptionalDependency: () => ({ status: 'not-installed' }),
}));

describe('observabilityPlugins', () => {
  const logger = { warn: jest.fn(), info: jest.fn(), verbose: jest.fn() };

  beforeEach(() => {
    init.mockReset();
    logger.warn.mockReset();
  });

  it('fails the boot on options @frontmcp/observability refuses, instead of starting without it', () => {
    const refusal = new ObservabilityConfigurationError(
      'Invalid ObservabilityPlugin options: stalls.thresholdMs: must be a whole number of milliseconds from 20 to 60000',
    );
    init.mockImplementation(() => {
      throw refusal;
    });

    expect(() =>
      observabilityPlugins({
        config: { tracing: false, logging: false, stalls: { thresholdMs: 5 } },
        logger: logger as never,
        globalProviders: {} as never,
      }),
    ).toThrow(refusal);
  });

  it('still starts without observability, with a warning, when the plugin fails for another reason', () => {
    init.mockImplementation(() => {
      throw new Error('broken install');
    });

    const plugins = observabilityPlugins({
      config: { tracing: false, logging: false },
      logger: logger as never,
      globalProviders: {} as never,
    });

    expect(plugins).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('observability: plugin initialization failed', {
      error: 'broken install',
    });
  });
});
