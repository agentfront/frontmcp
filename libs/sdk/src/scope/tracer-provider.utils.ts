interface OtelTraceApi {
  trace: { getTracerProvider(): unknown; setGlobalTracerProvider(provider: unknown): boolean };
  ProxyTracerProvider: abstract new (...args: never[]) => { getDelegateTracer(name: string): unknown };
}

/**
 * Whether a TracerProvider is registered. The global provider is always a `ProxyTracerProvider`,
 * registered or not; it has a delegate tracer once `register()` / `setGlobalTracerProvider()` ran.
 */
export function hasRegisteredTracerProvider({ trace, ProxyTracerProvider }: OtelTraceApi): boolean {
  const provider = trace.getTracerProvider();
  return !(provider instanceof ProxyTracerProvider) || provider.getDelegateTracer('frontmcp') !== undefined;
}

interface SdkTraceBase {
  BasicTracerProvider: new (config: { spanProcessors: unknown[] }) => unknown;
  SimpleSpanProcessor: new (exporter: unknown) => unknown;
}

/**
 * Registers a global provider that hands every span to `exporter` as it ends. `@opentelemetry/sdk-trace-base`
 * 2.x takes span processors only through the constructor: its providers have no `addSpanProcessor()` or `register()`.
 */
export function registerExportingTracerProvider(api: OtelTraceApi, sdk: SdkTraceBase, exporter: unknown): void {
  api.trace.setGlobalTracerProvider(
    new sdk.BasicTracerProvider({ spanProcessors: [new sdk.SimpleSpanProcessor(exporter)] }),
  );
}
