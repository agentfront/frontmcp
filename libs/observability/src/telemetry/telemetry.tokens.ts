/**
 * DI token for the TelemetryAccessor.
 *
 * CONTEXT-scoped — one instance per request.
 * Registered by ObservabilityPlugin when tracing is enabled.
 */
export const TELEMETRY_ACCESSOR = Symbol.for('frontmcp:observability:telemetry-accessor');

/**
 * DI token for the SCOPE-level TelemetryFactory.
 *
 * Unlike `TELEMETRY_ACCESSOR` (CONTEXT-scoped), this factory is resolvable
 * at scope-init time without an active request context. It's intended for
 * scope-lifetime singletons (e.g. `BundleStore`, security guards) that need
 * to create process-global counters / spans before any request arrives.
 *
 * Registered by ObservabilityPlugin when tracing is enabled.
 */
export const TELEMETRY_FACTORY = Symbol.for('frontmcp:observability:telemetry-factory');
