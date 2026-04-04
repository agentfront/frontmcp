import type { LogSink } from '../log-sink.interface';
import type { StructuredLogEntry } from '../structured-log.types';

/**
 * CallbackSink — forwards structured log entries to a user-provided function.
 *
 * Useful for custom integrations, testing, or forwarding to queues/streams.
 */
export class CallbackSink implements LogSink {
  constructor(private readonly fn: (entry: StructuredLogEntry) => void) {}

  write(entry: StructuredLogEntry): void {
    this.fn(entry);
  }
}
