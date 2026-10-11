import { type FrontMcpLogger, type PluginType } from '../common';
import { type ObservabilityOptionsInput } from '../common/types/options/observability/schema';
import { FrontMcpContextStorage } from '../context';
import LoggerRegistry from '../logger/logger.registry';
import type ProviderRegistry from '../provider/provider.registry';
import { probeOptionalDependency, requireOptionalModule } from './optional-dependency.util';
import { hasRegisteredTracerProvider, registerExportingTracerProvider } from './tracer-provider.utils';

export interface ObservabilityScopeOptions {
  config: Exclude<ObservabilityOptionsInput, false | undefined>;
  logger: FrontMcpLogger;
  globalProviders: ProviderRegistry;
}

/** The ObservabilityPlugin `observability` asks for, wired to the SDK logger and tracing; none if it fails to load. */
export function observabilityPlugins({
  config: observabilityConfig,
  logger,
  globalProviders,
}: ObservabilityScopeOptions): PluginType[] {
  const plugins: PluginType[] = [];
  let ObservabilityPluginModule: any;
  try {
    ObservabilityPluginModule = requireOptionalModule('@frontmcp/observability', () =>
      require('@frontmcp/observability'),
    );
  } catch (err) {
    // Don't blindly report "not installed" — `require()` also throws when the
    // package resolves but fails to load (export-condition / transpile / peer
    // mismatch, e.g. tsx + yarn resolving the source entry). Re-probe with the
    // runtime resolver so the warning matches reality and is debuggable (#453).
    const probe = probeOptionalDependency('@frontmcp/observability', err, require.resolve);
    if (probe.status === 'not-installed') {
      logger.warn(
        'observability config is set but @frontmcp/observability is not installed. ' +
          'Install it with: npm install @frontmcp/observability',
      );
    } else {
      logger.warn(
        'observability config is set and @frontmcp/observability resolved but failed to load — ' +
          'telemetry is disabled. Reinstalling will not help: this is usually an export-condition or ' +
          'transpile mismatch (e.g. a dev runtime resolving the package source instead of its built ' +
          'entry) or a failing transitive peer dependency. Inspect the resolved path and error below.',
        { resolvedPath: probe.resolvedPath, error: probe.error },
      );
    }
  }
  if (ObservabilityPluginModule)
    try {
      const { ObservabilityPlugin } = ObservabilityPluginModule;
      const pluginOptions = observabilityConfig === true ? {} : observabilityConfig;
      plugins.push(ObservabilityPlugin.init(pluginOptions));
      logger.verbose('observability: auto-loaded ObservabilityPlugin from config');

      // Wire StructuredLogTransport into the SDK logger pipeline so that
      // every logger.info() call flows through it with trace correlation.
      const loggingEnabled = pluginOptions.logging !== false;
      if (loggingEnabled) {
        try {
          const { StructuredLogTransport, createSinks } = ObservabilityPluginModule;
          let loggerRegistry: any;
          try {
            loggerRegistry = globalProviders.get(LoggerRegistry);
          } catch {
            /* not available */
          }
          if (
            loggerRegistry &&
            typeof loggerRegistry.addTransport === 'function' &&
            !loggerRegistry._hasStructuredTransport
          ) {
            const rawLogging = pluginOptions.logging;
            const loggingOpts: Record<string, unknown> =
              rawLogging === true ? {} : typeof rawLogging === 'object' ? rawLogging : {};
            const sinks = createSinks(loggingOpts['sinks'] as any);
            let contextStorage: any;
            try {
              contextStorage = globalProviders.get(FrontMcpContextStorage);
            } catch {
              /* not available */
            }
            const contextAccessor = contextStorage
              ? () => {
                  const ctx = contextStorage.getStore();
                  if (!ctx) return undefined;
                  return {
                    requestId: ctx.requestId,
                    traceContext: ctx.traceContext,
                    sessionIdHash: require('@frontmcp/utils').sha256Hex(ctx.sessionId).slice(0, 12),
                    scopeId: ctx.scopeId,
                    flowName: ctx.flow?.name,
                    elapsed: ctx.elapsed(),
                  };
                }
              : undefined;

            const transport = new StructuredLogTransport(
              sinks,
              {
                redactFields: loggingOpts['redactFields'] as string[] | undefined,
                includeStacks: loggingOpts['includeStacks'] as boolean | undefined,
                staticFields: loggingOpts['staticFields'] as Record<string, unknown> | undefined,
              },
              contextAccessor,
            );

            // Each entry logged during a request joins that request's log (`observability.requestLogs`)
            transport.onEntry = (entry: unknown) => {
              const requestLog = contextStorage
                ?.getStore()
                ?.get(Symbol.for('frontmcp:observability:request-log-collector'));
              (requestLog as { addEntry?: (logged: unknown) => void } | undefined)?.addEntry?.(entry);
            };
            loggerRegistry.addTransport(transport);
            loggerRegistry._hasStructuredTransport = true;
            logger.verbose('observability: wired StructuredLogTransport into SDK logger');
          }
        } catch (e) {
          logger.warn('observability: failed to wire structured logging', {
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      }

      // Auto-configure tracing exporter if none is set
      if (pluginOptions.tracing !== false) {
        try {
          if (!hasRegisteredTracerProvider(require('@opentelemetry/api'))) {
            const { isDevelopment: checkDev } = require('@frontmcp/utils');
            if (checkDev()) {
              const sdkTraceBase = require('@opentelemetry/sdk-trace-base');
              const { PrettySpanExporter } = ObservabilityPluginModule;
              const exporter = PrettySpanExporter ? new PrettySpanExporter() : new sdkTraceBase.ConsoleSpanExporter();
              registerExportingTracerProvider(require('@opentelemetry/api'), sdkTraceBase, exporter);
              logger.info('observability: auto-configured tracing (development mode)');
            } else {
              logger.warn(
                'observability: tracing enabled but no TracerProvider configured. ' +
                  'Set OTEL_EXPORTER_OTLP_ENDPOINT or call setupOTel() before server start.',
              );
            }
          }
        } catch (e) {
          logger.warn('observability: could not set up development tracing; spans are not recorded', {
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      }
    } catch (e) {
      logger.warn('observability: plugin initialization failed', {
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  return plugins;
}
