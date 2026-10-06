import type PluginRegistry from '../plugin/plugin.registry';

/** What the server registered and how long it took to start, as `@frontmcp/observability`'s `startupReport` reports it. */
export interface StartupReport {
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
  pluginsCount: number;
  durationMs: number;
  scopeId: string;
}

interface StartupReporter {
  reportStartupTelemetry?(report: StartupReport): void;
}

/** Hands the server's startup report to the plugins that take one. */
export function reportStartup(plugins: PluginRegistry | undefined, report: Omit<StartupReport, 'pluginsCount'>): void {
  const installed = plugins?.getPlugins() ?? [];
  for (const plugin of installed) {
    (plugin as StartupReporter).reportStartupTelemetry?.({ ...report, pluginsCount: installed.length });
  }
}
