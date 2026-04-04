import type { LogSink, SinkConfig } from './log-sink.interface';
import { StdoutSink } from './sinks/stdout.sink';
import { ConsoleSink } from './sinks/console.sink';
import { CallbackSink } from './sinks/callback.sink';

/**
 * Create a LogSink from a SinkConfig.
 *
 * Winston and Pino sinks are instantiated inline to avoid
 * bundling their types when not used.
 */
export function createSink(config: SinkConfig): LogSink {
  switch (config.type) {
    case 'stdout':
      return new StdoutSink({ stream: config.stream, pretty: config.pretty });

    case 'console':
      return new ConsoleSink();

    case 'winston': {
      const { WinstonSink } = require('./sinks/winston.sink');
      return new WinstonSink(config.logger);
    }

    case 'pino': {
      const { PinoSink } = require('./sinks/pino.sink');
      return new PinoSink(config.logger);
    }

    case 'callback':
      return new CallbackSink(config.fn);

    case 'otlp': {
      const { OtlpSink } = require('./sinks/otlp.sink');
      return new OtlpSink({
        endpoint:
          config.endpoint ??
          (typeof process !== 'undefined' ? process.env?.['OTEL_EXPORTER_OTLP_ENDPOINT'] : undefined) ??
          'http://localhost:4318',
        headers: config.headers,
        batchSize: config.batchSize,
        flushIntervalMs: config.flushIntervalMs,
        serviceName: config.serviceName,
      });
    }

    default:
      throw new Error(`Unknown sink type: ${(config as SinkConfig).type}`);
  }
}

/**
 * Create an array of LogSink instances from an array of SinkConfig.
 *
 * If no configs are provided, defaults to StdoutSink in Node.js
 * or ConsoleSink in browser environments.
 */
export function createSinks(configs?: SinkConfig[]): LogSink[] {
  if (configs && configs.length > 0) {
    return configs.map(createSink);
  }

  // No default sinks — the StructuredLogTransport runs without output sinks.
  // Telemetry data still flows to RequestLogCollector and OTel spans.
  // Add explicit sinks for output: { type: 'stdout' }, { type: 'otlp' },
  // { type: 'callback', fn: ... }, etc.
  // The SDK console logger (Stream 1) handles dev console output independently.
  return [];
}
