/**
 * DI token for the TelemetryAccessor.
 *
 * CONTEXT-scoped — one instance per request.
 * Registered by ObservabilityPlugin when tracing is enabled.
 */
export const TELEMETRY_ACCESSOR = Symbol.for('frontmcp:observability:telemetry-accessor');
