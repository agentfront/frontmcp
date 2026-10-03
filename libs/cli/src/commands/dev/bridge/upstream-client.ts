/**
 * Upstream MCP client for the dev bridge (issue #399).
 *
 * Two transport variants:
 *
 *   - **HTTP mode**: speaks streamable-HTTP JSON-RPC to the child's HTTP
 *     listener. The session id is the one the SERVER issues on `initialize`
 *     (`mcp-session-id` response header) and is sent on every later request.
 *     The bridge used to pin a uuid of its own, which the server never issued,
 *     so every request after `initialize` answered 404 (#679).
 *
 *   - **Pipe mode (--serve)**: forwards JSON-RPC frames over the Node IPC
 *     channel paired with the child (`FRONTMCP_DEV_STDIO_FD=3`); the SDK serves
 *     MCP on it. No HTTP layer, no session header.
 *
 * A restarted child has no session at all, so the bridge replays the client's
 * MCP handshake against it (`reinitialize`) before draining buffered requests.
 * The client keeps its stdio connection and never learns the server restarted.
 */

import type { ChildProcess } from 'node:child_process';

import type { BridgeLogger } from './log';
import type { JsonRpcFrame } from './stdio-framer';

export interface UpstreamClient {
  send(frame: JsonRpcFrame): Promise<void>;
  /**
   * Replay the client's handshake on a fresh child: send `initialize` (under a
   * bridge-private id, its response is not relayed) and, when the client had
   * sent it, `notifications/initialized`. Resolves with the `initialize` result.
   */
  reinitialize(initialize: JsonRpcFrame, initialized: boolean): Promise<Record<string, unknown> | undefined>;
  /** Stop background tasks (in-flight requests, pipe listener). */
  close(): Promise<void>;
}

export interface UpstreamClientOptions {
  log: BridgeLogger;
  /** Called for every frame the upstream child sends back. */
  onFrame: (frame: JsonRpcFrame) => void | Promise<void>;
}

const SESSION_HEADER = 'mcp-session-id';
let reinitCounter = 0;

/** Id for a bridge-originated `initialize`, never colliding with client ids. */
function nextReinitId(): string {
  reinitCounter += 1;
  return `frontmcp-dev-bridge:reinitialize:${reinitCounter}`;
}

function initializedNotification(): JsonRpcFrame {
  return { jsonrpc: '2.0', method: 'notifications/initialized' };
}

function resultOf(frame: JsonRpcFrame | undefined, method: string): Record<string, unknown> | undefined {
  if (!frame) throw new Error(`no response to the replayed ${method}`);
  if (frame.error) throw new Error(`replayed ${method} failed: ${frame.error.message}`);
  return typeof frame.result === 'object' && frame.result !== null
    ? (frame.result as Record<string, unknown>)
    : undefined;
}

// ─── HTTP mode ──────────────────────────────────────────────────────────

export interface HttpUpstreamOptions extends UpstreamClientOptions {
  /** Loopback URL of the user-code MCP endpoint. */
  url: string;
}

export function createHttpUpstream(options: HttpUpstreamOptions): UpstreamClient {
  const { log, url, onFrame } = options;
  // Track every in-flight request — `close()` must abort all of them,
  // not just whichever happened to be assigned last. A shared scalar
  // would let concurrent sends clobber each other's controller.
  const abortControllers = new Set<AbortController>();
  // Issued by the server in the `initialize` response.
  let sessionId: string | undefined;

  async function post(frame: JsonRpcFrame, deliver: (frame: JsonRpcFrame) => void | Promise<void>): Promise<void> {
    const abortController = new AbortController();
    abortControllers.add(abortController);
    const signal = abortController.signal;
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      // `initialize` starts a new session: never send a stale id with it.
      if (sessionId && frame.method !== 'initialize') headers[SESSION_HEADER] = sessionId;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(frame),
        signal,
      });

      if (!res.ok) {
        // Reject so the FSM can clear inflight bookkeeping and synthesise
        // a JSON-RPC error response back to the client. Silently swallowing
        // a non-OK status here leaves callers hanging.
        log.warn('http-upstream-non-ok', { status: res.status, method: frame.method });
        throw new Error(`upstream returned ${res.status} for ${frame.method ?? 'request'}`);
      }

      const issued = res.headers.get(SESSION_HEADER);
      if (issued && frame.method === 'initialize') {
        sessionId = issued;
        log.info('http-upstream-session');
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
              await deliver(parsed);
            } catch (err) {
              log.warn('sse-parse-error', { error: (err as Error).message, raw: json.slice(0, 200) });
            }
          }
        }
      } else if (contentType.includes('application/json')) {
        // Single JSON response.
        const body = (await res.json()) as JsonRpcFrame;
        await deliver(body);
      }
      // Anything else (202 Accepted for a notification) carries no frame.
    } catch (err) {
      // AbortError surfaces when close() interrupts an in-flight request
      // during reload; that's expected, so log it at info-not-error. We
      // still rethrow so the FSM can clear inflight bookkeeping and
      // synthesise an error response on its end.
      if ((err as { name?: string }).name === 'AbortError') {
        log.info('http-upstream-aborted', { method: frame.method });
      } else {
        log.error('http-upstream-error', { error: (err as Error).message, method: frame.method });
      }
      throw err;
    } finally {
      abortControllers.delete(abortController);
    }
  }

  return {
    send: (frame) => post(frame, onFrame),
    async reinitialize(initialize, initialized) {
      const id = nextReinitId();
      let response: JsonRpcFrame | undefined;
      await post({ ...initialize, id }, async (frame) => {
        if (frame.id === id) response = frame;
        else await onFrame(frame);
      });
      const result = resultOf(response, 'initialize');
      if (initialized) await post(initializedNotification(), onFrame);
      return result;
    },
    close: async () => {
      for (const ac of abortControllers) ac.abort();
      abortControllers.clear();
    },
  };
}

// ─── Pipe mode (--serve) ────────────────────────────────────────────────

export interface PipeUpstreamOptions extends UpstreamClientOptions {
  /** The spawned child; we write to / read from its IPC channel (FD 3). */
  child: ChildProcess;
  /** How long a replayed `initialize` may take. */
  reinitializeTimeoutMs?: number;
}

/**
 * Pipe mode: the child speaks JSON-RPC on FD 3 (set via
 * `FRONTMCP_DEV_STDIO_FD=3`). We use Node's IPC channel for the same wire
 * — `child.send(...)` forwards a structured message and `child.on('message', …)`
 * yields whatever the child writes back.
 */
export function createPipeUpstream(options: PipeUpstreamOptions): UpstreamClient {
  const { log, child, onFrame, reinitializeTimeoutMs = 10_000 } = options;
  const pending = new Map<string, (frame: JsonRpcFrame) => void>();

  function handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') {
      log.warn('pipe-upstream-non-object', { type: typeof msg });
      return;
    }
    // SDK control messages (`{ __frontmcp: 'ready' }`) are not JSON-RPC.
    if ((msg as { __frontmcp?: unknown }).__frontmcp !== undefined) return;
    const frame = msg as JsonRpcFrame;
    const waiter = typeof frame.id === 'string' ? pending.get(frame.id) : undefined;
    if (waiter) {
      waiter(frame);
      return;
    }
    void onFrame(frame);
  }

  child.on('message', handleMessage);

  async function send(frame: JsonRpcFrame): Promise<void> {
    if (!child.connected) {
      log.warn('pipe-upstream-disconnected', { method: frame.method });
      throw new Error(`pipe upstream disconnected for ${frame.method ?? 'request'}`);
    }
    await new Promise<void>((resolve, reject) => {
      child.send(frame, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch((err: Error) => {
      // Reject so the FSM can produce a JSON-RPC error response back to
      // the client rather than leaving the request stuck inflight.
      log.warn('pipe-upstream-send-error', { error: err.message, method: frame.method });
      throw err;
    });
  }

  return {
    send,
    async reinitialize(initialize, initialized) {
      const id = nextReinitId();
      let timer: NodeJS.Timeout | undefined;
      const response = new Promise<JsonRpcFrame>((resolve, reject) => {
        pending.set(id, resolve);
        timer = setTimeout(
          () => reject(new Error(`no response to the replayed initialize within ${reinitializeTimeoutMs}ms`)),
          reinitializeTimeoutMs,
        );
      });
      try {
        await send({ ...initialize, id });
        const result = resultOf(await response, 'initialize');
        if (initialized) await send(initializedNotification());
        return result;
      } finally {
        if (timer) clearTimeout(timer);
        pending.delete(id);
      }
    },
    close: async () => {
      child.off('message', handleMessage);
      pending.clear();
    },
  };
}
