export { McpAttributes, FrontMcpAttributes, HttpAttributes, RpcAttributes, EnduserAttributes } from './otel.types';
export type { TracingOptions, OTelSetupOptions } from './otel.types';

export { OTEL_TRACER, OTEL_CONFIG } from './otel.tokens';

export { frontmcpToOTelSpanContext, otelToFrontmcpContext, createOTelContextFromTrace } from './trace-context-bridge';
export type { TraceContextLike } from './trace-context-bridge';

export { FrontMcpPropagator } from './context-propagator';

export { setupOTel } from './otel.setup';

export * from './spans';
