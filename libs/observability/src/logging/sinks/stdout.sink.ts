import type { LogSink } from '../log-sink.interface';
import type { StructuredLogEntry } from '../structured-log.types';

/**
 * StdoutSink — writes NDJSON (newline-delimited JSON) to process.stdout.
 *
 * 12-factor compliant: logs are written as a stream of events to stdout,
 * ready for collection by Docker, K8s, CloudWatch, or any log aggregator.
 */
export class StdoutSink implements LogSink {
  private readonly stream: NodeJS.WritableStream;
  private readonly pretty: boolean;

  constructor(options?: { stream?: NodeJS.WritableStream; pretty?: boolean }) {
    this.stream = options?.stream ?? process.stdout;
    this.pretty = options?.pretty ?? false;
  }

  write(entry: StructuredLogEntry): void {
    const line = this.pretty ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
    this.stream.write(line + '\n');
  }
}
