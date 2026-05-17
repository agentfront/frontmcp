/**
 * Newline-delimited JSON-RPC framer for the dev bridge (issue #399).
 *
 * Reads `process.stdin` and yields complete JSON-RPC frames. Writes
 * complete frames to `process.stdout` (atomic per `\n` boundary). Parser
 * state is preserved across chunks so frames split arbitrarily on the
 * wire still parse.
 *
 * MCP stdio framing per spec is newline-delimited JSON (`\n`-terminated
 * UTF-8). We do NOT implement LSP-style `Content-Length` framing — it's
 * not in the MCP spec and adding it would silently shadow real JSON
 * bodies that happen to start with `C`.
 */

import type { Readable, Writable } from 'node:stream';

import { makeDevError } from './errors';
import type { BridgeLogger } from './log';

export interface JsonRpcFrame {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface StdioFramerOptions {
  input: Readable;
  output: Writable;
  log: BridgeLogger;
  onFrame: (frame: JsonRpcFrame) => void | Promise<void>;
}

export interface StdioFramer {
  start(): void;
  /** Write a single frame as a newline-terminated JSON line. Resolves on `'drain'` when backpressure kicks in. */
  write(frame: JsonRpcFrame): Promise<void>;
  stop(): void;
}

/**
 * Build a newline-delimited JSON framer bound to the supplied streams.
 *
 * Parse errors (malformed JSON between newlines) emit a `-32700` Parse
 * error response back on the output stream and continue — a malformed
 * frame must not kill the bridge.
 */
export function createStdioFramer(options: StdioFramerOptions): StdioFramer {
  const { input, output, log, onFrame } = options;
  let buffer = '';
  let paused = false;
  let drainResolvers: Array<() => void> = [];

  function flushBuffer(): void {
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (raw.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        log.warn('parse-error', { raw: raw.slice(0, 200), error: (err as Error).message });
        void write(makeDevError(null, -32700, { reason: 'parse_error' }) as JsonRpcFrame);
        continue;
      }
      if (!parsed || typeof parsed !== 'object') {
        log.warn('parse-error', { raw: raw.slice(0, 200), reason: 'not_object' });
        continue;
      }
      void onFrame(parsed as JsonRpcFrame);
    }
  }

  function onData(chunk: Buffer | string): void {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    flushBuffer();
  }

  function write(frame: JsonRpcFrame): Promise<void> {
    return new Promise<void>((resolve) => {
      const line = JSON.stringify(frame) + '\n';
      const ok = output.write(line);
      if (ok) return resolve();
      // Backpressure: pause inbound parsing until drain.
      paused = true;
      drainResolvers.push(resolve);
    });
  }

  function onDrain(): void {
    paused = false;
    const resolvers = drainResolvers;
    drainResolvers = [];
    for (const r of resolvers) r();
  }

  return {
    start: () => {
      input.setEncoding?.('utf-8');
      input.on('data', onData);
      output.on('drain', onDrain);
    },
    write,
    stop: () => {
      input.off('data', onData);
      output.off('drain', onDrain);
    },
  };
}
