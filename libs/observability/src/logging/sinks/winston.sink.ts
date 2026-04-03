import type { LogSink, WinstonLike } from '../log-sink.interface';
import type { StructuredLogEntry } from '../structured-log.types';

/**
 * WinstonSink — forwards structured log entries to a winston logger.
 *
 * Maps FrontMCP log levels to winston levels and passes the full
 * entry object as metadata so winston formatters can access all fields.
 */
export class WinstonSink implements LogSink {
  constructor(private readonly logger: WinstonLike) {}

  write(entry: StructuredLogEntry): void {
    const { message, level, ...meta } = entry;
    const winstonLevel = mapToWinstonLevel(level);

    switch (winstonLevel) {
      case 'debug':
        this.logger.debug(message, meta);
        break;
      case 'info':
        this.logger.info(message, meta);
        break;
      case 'warn':
        this.logger.warn(message, meta);
        break;
      case 'error':
        this.logger.error(message, meta);
        break;
    }
  }
}

function mapToWinstonLevel(level: string): 'debug' | 'info' | 'warn' | 'error' {
  switch (level) {
    case 'debug':
    case 'verbose':
      return 'debug';
    case 'info':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    default:
      return 'info';
  }
}
