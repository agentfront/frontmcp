/**
 * Upstream MCP client for the dev bridge (issue #399).
 *
 * Two transport variants:
 *
 *   - **HTTP mode**: speaks streamable-HTTP JSON-RPC to the child's HTTP
 *     listener at `http://127.0.0.1:<port>/`. Carries the bridge-pinned
 *     `mcp-session-id` header on every request so session continuity
 *     survives reload.
 *
 *   - **Pipe mode (--serve)**: writes/reads newline-delimited JSON-RPC
 *     frames on a pair of FDs paired with the child via `child_process`
 *     IPC. The child opens these FDs because `FRONTMCP_DEV_STDIO_FD` is
 *     set; the bridge writes requests, reads responses, no HTTP layer.
 */

import type { ChildProcess } from 'node:child_process';

import type { BridgeLogger } from './log';
import type { JsonRpcFrame } from './stdio-framer';

export interface UpstreamClient {
  send(frame: JsonRpcFrame): Promise<void>;
  /** Stop background tasks (SSE listener, pipe parser). */
  close(): Promise<void>;
}

export interface UpstreamClientOptions {
  log: BridgeLogger;
  /** Called for every frame the upstream child sends back. */
  onFrame: (frame: JsonRpcFrame) => void | Promise<void>;
  /** Session id pinned by the bridge for HTTP mode. */
  sessionId?: string;
}

// ─── HTTP mode ──────────────────────────────────────────────────────────

export interface HttpUpstreamOptions extends UpstreamClientOptions {
  /** Loopback URL of the user-code HTTP server. */
  url: string;
}

export function createHttpUpstream(options: HttpUpstreamOptions): UpstreamClient {
  const { log, url, onFrame, sessionId } = options;
  // One controller per in-flight request — `close()` aborts whatever's
  // currently outstanding (an in-progress fetch or a long-running SSE
  // body read) so the bridge's reload path doesn't hang on a child that
  // already died. Cleared in `finally` so the next send() gets a fresh
  // controller and the close from a previous request isn't sticky.
  let abortController: AbortController | undefined;

  async function send(frame: JsonRpcFrame): Promise<void> {
    abortController = new AbortController();
    const signal = abortController.signal;
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      if (sessionId) headers['mcp-session-id'] = sessionId;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(frame),
        signal,
      });

      if (!res.ok) {
        log.warn('http-upstream-non-ok', { status: res.status, method: frame.method });
        return;
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        // SSE: parse `data: <json>` lines until the stream ends, forward each.
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const json = line.slice(5).trim();
            if (!json) continue;
            try {
              const parsed = JSON.parse(json) as JsonRpcFrame;
              await onFrame(parsed);
            } catch (err) {
              log.warn('sse-parse-error', { error: (err as Error).message, raw: json.slice(0, 200) });
            }
          }
        }
      } else {
        // Single JSON response.
        const body = (await res.json()) as JsonRpcFrame;
        await onFrame(body);
      }
    } catch (err) {
      // AbortError surfaces when close() interrupts an in-flight request
      // during reload; that's expected, so log it at info-not-error.
      if ((err as { name?: string }).name === 'AbortError') {
        log.info('http-upstream-aborted', { method: frame.method });
      } else {
        log.error('http-upstream-error', { error: (err as Error).message, method: frame.method });
      }
    } finally {
      abortController = undefined;
    }
  }

  return {
    send,
    close: async () => {
      abortController?.abort();
      abortController = undefined;
    },
  };
}

// ─── Pipe mode (--serve) ────────────────────────────────────────────────

export interface PipeUpstreamOptions extends UpstreamClientOptions {
  /** The forked child; we write to / read from the IPC pipe (FD 3). */
  child: ChildProcess;
}

/**
 * Pipe mode: the child speaks JSON-RPC on FD 3 (set via
 * `FRONTMCP_DEV_STDIO_FD=3`). We use Node's IPC channel for the same wire
 * — `child.send(...)` forwards a structured message and `child.on('message', …)`
 * yields whatever the child writes back.
 *
 * (Node's IPC wraps JSON over a pipe internally; the framing is consistent
 * with what `runStdio` would write if it were pointed at FD 3.)
 */
export function createPipeUpstream(options: PipeUpstreamOptions): UpstreamClient {
  const { log, child, onFrame } = options;

  function handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') {
      log.warn('pipe-upstream-non-object', { type: typeof msg });
      return;
    }
    void onFrame(msg as JsonRpcFrame);
  }

  child.on('message', handleMessage);

  async function send(frame: JsonRpcFrame): Promise<void> {
    if (!child.connected) {
      log.warn('pipe-upstream-disconnected', { method: frame.method });
      return;
    }
    await new Promise<void>((resolve, reject) => {
      child.send(frame, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch((err: Error) => {
      log.warn('pipe-upstream-send-error', { error: err.message, method: frame.method });
    });
  }

  return {
    send,
    close: async () => {
      child.off('message', handleMessage);
    },
  };
}
