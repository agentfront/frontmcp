import type { LogSink, PinoLike } from '../log-sink.interface';
import type { StructuredLogEntry } from '../structured-log.types';

/**
 * PinoSink — forwards structured log entries to a pino logger.
 *
 * Pino uses the signature `logger.info(obj, msg)` where the object
 * comes first, so we pass the entry fields as the merge object.
 */
export class PinoSink implements LogSink {
  constructor(private readonly logger: PinoLike) {}

  write(entry: StructuredLogEntry): void {
    const { message, level, ...obj } = entry;
    const pinoLevel = mapToPinoLevel(level);

    switch (pinoLevel) {
      case 'debug':
        this.logger.debug(obj, message);
        break;
      case 'info':
        this.logger.info(obj, message);
        break;
      case 'warn':
        this.logger.warn(obj, message);
        break;
      case 'error':
        this.logger.error(obj, message);
        break;
    }
  }
}

function mapToPinoLevel(level: string): 'debug' | 'info' | 'warn' | 'error' {
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
