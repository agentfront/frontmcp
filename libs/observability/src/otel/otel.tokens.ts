/**
 * DI tokens for OpenTelemetry providers.
 */

/** Token for the OTel Tracer instance */
export const OTEL_TRACER = Symbol.for('frontmcp:observability:otel-tracer');

/** Token for the OTel tracing configuration */
export const OTEL_CONFIG = Symbol.for('frontmcp:observability:otel-config');
