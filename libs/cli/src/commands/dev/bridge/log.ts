/**
 * File logger for the dev bridge (issue #399).
 *
 * The bridge owns `process.stdout` for JSON-RPC frames — every log line
 * MUST go to a file (or stderr as fallback) so a single `console.log`
 * never corrupts the wire. Append-only, line-buffered, no rotation in v1
 * (operators can layer `logrotate`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ensureDir } from '@frontmcp/utils';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BridgeLogger {
  readonly path: string | undefined;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  reloadEvent(kind: string, data?: Record<string, unknown>): void;
  close(): Promise<void>;
}

interface CreateLoggerOptions {
  filePath?: string;
  /** When true, write the line to stderr as well — useful when --color is set. */
  alsoStderr?: boolean;
}

function formatLine(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const payload = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
  return `${ts} bridge ${level} ${message}${payload}\n`;
}

/**
 * Create the file logger. When `filePath` is undefined or opening the file
 * fails, falls back to stderr (stdout is reserved for JSON-RPC frames).
 */
export async function createBridgeLogger(options: CreateLoggerOptions = {}): Promise<BridgeLogger> {
  const filePath = options.filePath;
  let stream: fs.WriteStream | undefined;
  let resolvedPath: string | undefined;

  if (filePath) {
    try {
      const dir = path.dirname(path.resolve(filePath));
      await ensureDir(dir);
      stream = fs.createWriteStream(filePath, { flags: 'a' });
      resolvedPath = path.resolve(filePath);
    } catch {
      // Stream creation failed (read-only FS, permission denied, …).
      // Fall back to stderr-only logging; stdout stays clean.
      stream = undefined;
      resolvedPath = undefined;
    }
  }

  function write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const line = formatLine(level, message, data);
    if (stream) {
      try {
        stream.write(line);
      } catch {
        // Best-effort: a write failure mid-session falls back to stderr.
        process.stderr.write(line);
      }
    }
    if (!stream || options.alsoStderr) {
      process.stderr.write(line);
    }
  }

  return {
    path: resolvedPath,
    debug: (msg, data) => write('debug', msg, data),
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
    reloadEvent: (kind, data) => write('info', `reload-${kind}`, data),
    close: () =>
      new Promise<void>((resolve) => {
        if (!stream) return resolve();
        stream.end(() => resolve());
      }),
  };
}
