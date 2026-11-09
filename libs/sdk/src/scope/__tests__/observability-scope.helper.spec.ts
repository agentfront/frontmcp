import 'reflect-metadata';

import { InternalMcpError } from '../../errors';
import LoggerRegistry from '../../logger/logger.registry';
import { observabilityPlugins } from '../observability-scope.helper';

class ObservabilityConfigurationError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'OBSERVABILITY_CONFIGURATION');
  }
}

const init = jest.fn();
const createSinks = jest.fn((configs: unknown[]) => configs);

class StructuredLogTransport {
  onEntry?: (entry: unknown) => void;
}

jest.mock('../optional-dependency.util', () => ({
  requireOptionalModule: () => ({ ObservabilityPlugin: { init }, StructuredLogTransport, createSinks }),
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

  describe('the sinks observability.logging wires to the server logger', () => {
    function sinksFor(logging: unknown): unknown {
      createSinks.mockClear();
      const loggerRegistry = { addTransport: jest.fn() };
      const globalProviders = {
        get: (token: unknown) => {
          if (token === LoggerRegistry) return loggerRegistry;
          throw new Error('not registered');
        },
      };
      observabilityPlugins({
        config: { tracing: false, ...(logging === undefined ? {} : { logging }) } as never,
        logger: logger as never,
        globalProviders: globalProviders as never,
      });
      expect(loggerRegistry.addTransport).toHaveBeenCalledTimes(1);
      return createSinks.mock.calls[0][0];
    }

    it('adds the NDJSON stdout sink for logging: true, and for an object that names no sinks', () => {
      expect(sinksFor(true)).toEqual([{ type: 'stdout' }]);
      expect(sinksFor({ redactFields: ['token'] })).toEqual([{ type: 'stdout' }]);
    });

    it('uses the sinks an object names, none included', () => {
      expect(sinksFor({ sinks: [{ type: 'console' }] })).toEqual([{ type: 'console' }]);
      expect(sinksFor({ sinks: [] })).toEqual([]);
    });

    it('writes nothing without logging: the transport only feeds request logs', () => {
      expect(sinksFor(undefined) ?? []).toEqual([]);
    });
  });
});
