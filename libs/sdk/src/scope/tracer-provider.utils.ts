interface OtelTraceApi {
  trace: { getTracerProvider(): unknown };
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
