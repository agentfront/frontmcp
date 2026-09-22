import type { LogSink } from '../log-sink.interface';
import type { StructuredLogEntry } from '../structured-log.types';

/**
 * Where NDJSON goes when the caller did not name a stream.
 *
 * In stdio mode stdout carries the MCP JSON-RPC frames, so a log line written there corrupts the
 * wire. `runStdio()` already redirects the stdout-bound `console` methods to stderr, but this sink
 * writes the stream directly and so is not covered by that: without this it is the one logging path
 * that can still break a stdio server.
 *
 * Read per-construction, not at module load: `runStdio()` sets the flag before the logging stack is
 * built, but after this module is imported.
 */
function defaultStream(): NodeJS.WritableStream {
  const flag = typeof process !== 'undefined' ? process.env?.['FRONTMCP_STDIO'] : undefined;
  return flag === '1' || flag === 'true' ? process.stderr : process.stdout;
}

/**
 * StdoutSink — writes NDJSON (newline-delimited JSON) to process.stdout.
 *
 * 12-factor compliant: logs are written as a stream of events to stdout,
 * ready for collection by Docker, K8s, CloudWatch, or any log aggregator.
 *
 * Under `FRONTMCP_STDIO` the default target moves to stderr, which keeps the aggregator working
 * while leaving stdout to the protocol. An explicit `stream` is always honoured — a caller naming
 * a target has said what they want.
 */
export class StdoutSink implements LogSink {
  private readonly stream: NodeJS.WritableStream;
  private readonly pretty: boolean;

  constructor(options?: { stream?: NodeJS.WritableStream; pretty?: boolean }) {
    this.stream = options?.stream ?? defaultStream();
    this.pretty = options?.pretty ?? false;
  }

  write(entry: StructuredLogEntry): void {
    const line = this.pretty ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
    this.stream.write(line + '\n');
  }
}
