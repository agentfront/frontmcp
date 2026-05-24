// ──── Plugin ────
export { ObservabilityPlugin, sessionTracingId, reportStartup } from './plugin';
export type {
  ObservabilityPluginOptions,
  ObservabilityPluginOptionsInput,
  ObservabilityLoggingOptions,
} from './plugin';

// ──── OpenTelemetry ────
export {
  McpAttributes,
  FrontMcpAttributes,
  HttpAttributes,
  RpcAttributes,
  EnduserAttributes,
  OTEL_TRACER,
  OTEL_CONFIG,
  frontmcpToOTelSpanContext,
  otelToFrontmcpContext,
  createOTelContextFromTrace,
  FrontMcpPropagator,
  setupOTel,
  // Span creators
  startSpan,
  endSpanOk,
  endSpanError,
  withSpan,
  startHttpServerSpan,
  setHttpResponseStatus,
  startRpcSpan,
  startToolSpan,
  startResourceSpan,
  startPromptSpan,
  recordHookEvent,
  startHookSpan,
  startFetchSpan,
  setFetchResponseStatus,
  startTransportSpan,
  setTransportRequestType,
  startAuthSpan,
  setAuthMode,
  setAuthResult,
  emitStartupReport,
  PrettySpanExporter,
} from './otel';
export type {
  TracingOptions,
  OTelSetupOptions,
  TraceContextLike,
  StartSpanOptions,
  HttpServerSpanOptions,
  RpcSpanOptions,
  ToolSpanOptions,
  ResourceSpanOptions,
  PromptSpanOptions,
  HookSpanOptions,
  FetchSpanOptions,
  TransportSpanOptions,
  AuthSpanOptions,
  StartupTelemetryData,
} from './otel';

// ──── Structured Logging ────
export {
  StructuredLogTransport,
  LOG_LEVEL_TO_OTEL_SEVERITY,
  StdoutSink,
  ConsoleSink,
  WinstonSink,
  PinoSink,
  CallbackSink,
  OtlpSink,
  createSink,
  createSinks,
  redactFields,
} from './logging';
export type {
  StructuredLogEntry,
  StructuredLogError,
  StructuredLogTransportOptions,
  LogSink,
  SinkConfig,
  StdoutSinkConfig,
  ConsoleSinkConfig,
  WinstonSinkConfig,
  PinoSinkConfig,
  CallbackSinkConfig,
  OtlpSinkConfig,
  OtlpSinkOptions,
  WinstonLike,
  PinoLike,
  ContextAccessor,
  ContextSnapshot,
} from './logging';

// ──── Developer Telemetry API ────
export {
  TelemetryAccessor,
  TelemetrySpan,
  TelemetryFactory,
  TELEMETRY_ACCESSOR,
  TELEMETRY_FACTORY,
  createCounter,
  getMetricSnapshot,
  getCounterTotal,
  resetMetricSnapshot,
  resetTelemetrySnapshotForTesting,
  resetCounterCacheForTesting,
  normalizeBundleSource,
  normalizeErrorReason,
  KNOWN_BUNDLE_SOURCES,
  KNOWN_ERROR_REASONS,
} from './telemetry';
export type { TelemetryCounter, CounterSnapshotEntry, KnownBundleSource, KnownErrorReason } from './telemetry';

// ──── Prometheus serializer (issue #397) ────
export { PROMETHEUS_CONTENT_TYPE, renderJsonExposition, renderPrometheusExposition } from './prometheus';
export type { GaugeSnapshotEntry, RenderOptions } from './prometheus';

// ──── Process-stats collector (issue #397) ────
export { ProcessStatsCollector } from './process-stats';

// ──── Testing Utilities ────
export {
  createTestTracer,
  getFinishedSpans,
  assertSpanExists,
  assertSpanAttribute,
  findSpan,
  findSpansByAttribute,
} from './testing';
export type { TestTracer } from './testing';

// ──── Request Logs ────
export { RequestLogCollector, REQUEST_LOG_COLLECTOR } from './request-log';
export type { RequestLog, RequestLogEntry, RequestLogCollectorOptions } from './request-log';
