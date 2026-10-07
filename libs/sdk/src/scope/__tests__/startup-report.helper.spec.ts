import { reportStartup, type StartupReport } from '../startup-report.helper';

const report = { toolsCount: 2, resourcesCount: 1, promptsCount: 0, durationMs: 12, scopeId: 'desk' };

function pluginRegistry(plugins: unknown[]) {
  return { getPlugins: () => plugins } as never;
}

describe('reportStartup', () => {
  it('logs a plugin that throws and still reports to the others', () => {
    const received: StartupReport[] = [];
    const logger = { warn: jest.fn() };
    const failing = {
      reportStartupTelemetry: () => {
        throw new Error('exporter offline');
      },
    };
    const working = { reportStartupTelemetry: (startup: StartupReport) => received.push(startup) };

    expect(() => reportStartup(pluginRegistry([failing, working]), report, logger as never)).not.toThrow();

    expect(received).toEqual([{ ...report, pluginsCount: 2 }]);
    expect(logger.warn).toHaveBeenCalledWith('A plugin failed to report startup telemetry', {
      error: 'exporter offline',
    });
  });
});
