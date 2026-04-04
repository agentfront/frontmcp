export type { StructuredLogEntry, StructuredLogError, StructuredLogTransportOptions } from './structured-log.types';
export { LOG_LEVEL_TO_OTEL_SEVERITY } from './structured-log.types';

export type {
  LogSink,
  SinkConfig,
  StdoutSinkConfig,
  ConsoleSinkConfig,
  WinstonSinkConfig,
  PinoSinkConfig,
  CallbackSinkConfig,
  OtlpSinkConfig,
  WinstonLike,
  PinoLike,
} from './log-sink.interface';

export { StructuredLogTransport } from './structured-log-transport';
export type { ContextAccessor, ContextSnapshot } from './structured-log-transport';

export { StdoutSink, ConsoleSink, WinstonSink, PinoSink, CallbackSink, OtlpSink } from './sinks';
export type { OtlpSinkOptions } from './sinks';
export { createSink, createSinks } from './sink.factory';
export { redactFields } from './redaction';
