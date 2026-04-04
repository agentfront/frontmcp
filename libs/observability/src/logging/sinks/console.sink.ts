import type { LogSink } from '../log-sink.interface';
import type { StructuredLogEntry } from '../structured-log.types';

/**
 * ConsoleSink — writes structured log entries to the console.
 *
 * Simple one-liner format with trace context. Use this sink when you want
 * telemetry data in the console (e.g., browser, or when the SDK console
 * logger is disabled).
 *
 * For typical development, you don't need this sink — the SDK's built-in
 * console logger handles dev output. The telemetry pipeline runs separately
 * via StructuredLogTransport and its configured sinks (stdout, otlp, callback).
 */
export class ConsoleSink implements LogSink {
  write(entry: StructuredLogEntry): void {
    const method = levelToConsoleMethod(entry.level);
    const formatted = formatEntry(entry);
    method(formatted);
  }
}

function formatEntry(entry: StructuredLogEntry): string {
  const useAnsi = typeof process !== 'undefined' && !!process.stdout?.isTTY;
  const ts = entry.timestamp.slice(11, 23); // HH:MM:SS.mmm
  const level = entry.level.toUpperCase().padEnd(7);
  const traceShort = entry.trace_id ? entry.trace_id.slice(0, 8) : '';
  const reqShort = entry.request_id ? entry.request_id.slice(0, 8) : '';

  const parts: string[] = [];
  const DIM = useAnsi ? '\x1b[2m' : '';
  const BOLD = useAnsi ? '\x1b[1m' : '';
  const RESET = useAnsi ? '\x1b[0m' : '';
  const levelColor = useAnsi ? (LEVEL_COLORS[entry.level] ?? '') : '';

  parts.push(`${DIM}[${ts}]${RESET}`);
  parts.push(`${BOLD}${levelColor}${level}${RESET}`);
  if (traceShort || reqShort) {
    parts.push(`${DIM}[${traceShort}${reqShort ? ':' + reqShort : ''}]${RESET}`);
  }
  if (entry.prefix) parts.push(`${DIM}[${entry.prefix}]${RESET}`);
  parts.push(entry.message);

  if (entry.attributes && Object.keys(entry.attributes).length > 0) {
    const attrs = Object.entries(entry.attributes)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    parts.push(`${DIM}{ ${attrs} }${RESET}`);
  }

  if (entry.error) {
    parts.push(`[${entry.error.type}: ${entry.error.message}]`);
  }

  if (entry.elapsed_ms !== undefined) {
    parts.push(`${DIM}(${entry.elapsed_ms}ms)${RESET}`);
  }

  return parts.join(' ');
}

const LEVEL_COLORS: Record<string, string> = {
  debug: '\x1b[34m',
  verbose: '\x1b[90m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

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
