import type { LogSink } from '../log-sink.interface';
import type { StructuredLogEntry } from '../structured-log.types';

/**
 * ConsoleSink — writes structured log entries via console methods.
 *
 * Browser-safe: uses console.debug/info/warn/error which are available
 * in all JS runtimes. Passes the full entry object so browser devtools
 * can render it as an expandable object.
 */
export class ConsoleSink implements LogSink {
  write(entry: StructuredLogEntry): void {
    const method = levelToConsoleMethod(entry.level);
    method(entry);
  }
}

function levelToConsoleMethod(level: string): (...args: unknown[]) => void {
  switch (level) {
    case 'debug':
    case 'verbose':
      return console.debug;
    case 'info':
      return console.info;
    case 'warn':
      return console.warn;
    case 'error':
      return console.error;
    default:
      return console.log;
  }
}
