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
 *
 * In HTTP mode the bridge also relays the session's standalone notification
 * stream, which carries what the server sends on its own.
 */

import type { ChildProcess } from 'node:child_process';

import {
  advertisesChannels,
  declaringChannels,
  DISCOVER_HEADERS,
  discoverRequest,
  namesProtocol20260728,
  serverRevisionsOf,
  unsupportedProtocolVersion,
  type ServerRevisions,
} from './claude-code-channels';
import { createNotificationStream, SESSION_HEADER } from './notification-stream';
import { relaySseFrames } from './sse-frames';
import type { JsonRpcFrame } from './stdio-framer';
import type { BridgeLogger } from './types';

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

const END_SESSION_TIMEOUT_MS = 2_000;
let bridgeRequestCounter = 0;

/** Id for a request the bridge sends for itself (`reinitialize`, `discover`), never colliding with client ids. */
function nextBridgeId(purpose: string): string {
  bridgeRequestCounter += 1;
  return `frontmcp-dev-bridge:${purpose}:${bridgeRequestCounter}`;
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
  /** Sent with every request, such as the credential a shared local server asks for. */
  headers?: Record<string, string>;
  /** Sends the requests instead of the global `fetch`, such as one that reaches a Unix socket. */
  fetch?: typeof fetch;
  /**
   * Serve Claude Code channels: declare `experimental['claude/channel']` on the client's `initialize`, and answer
   * the 2026-07-28 requests of a server that advertises it with `-32022`, since Claude Code delivers channel
   * events only to a session. Without it, every frame is relayed as it is.
   */
  claudeCodeChannels?: boolean;
  /** Called once when the session's notification stream is given up, as a server that went away makes it. */
  onNotificationStreamLost?: () => void;
}

export interface HttpUpstreamClient extends UpstreamClient {
  /** End the MCP session the server issued (`DELETE` with its id); the next `initialize` starts a new one. */
  endSession(): Promise<void>;
  /** Forget the session of a server that went away, without telling it: its notification stream is closed. */
  leaveSession(): void;
}

export function createHttpUpstream(options: HttpUpstreamOptions): HttpUpstreamClient {
  const { log, url, onFrame } = options;
  // Track every in-flight request — `close()` must abort all of them,
  // not just whichever happened to be assigned last. A shared scalar
  // would let concurrent sends clobber each other's controller.
  const abortControllers = new Set<AbortController>();
  // Issued by the server in the `initialize` response.
  let sessionId: string | undefined;
  // What a `server/discover` said of the server, asked once a client frame names 2026-07-28.
  let revisions: ServerRevisions | undefined;
  // Settles once the server answered the session's notification stream: what a request sets off is not missed.
  let streamAnswered: Promise<void> = Promise.resolve();
  const notifications = createNotificationStream({
    url,
    headers: options.headers,
    fetch: options.fetch,
    log,
    onFrame,
    onLost: options.onNotificationStreamLost,
  });

  /** The session id, for every frame but `initialize`, which starts a new session: never send a stale id with it. */
  function sessionHeaders(frame: JsonRpcFrame): Record<string, string> {
    return sessionId && frame.method !== 'initialize' ? { [SESSION_HEADER]: sessionId } : {};
  }

  async function post(
    frame: JsonRpcFrame,
    deliver: (frame: JsonRpcFrame) => void | Promise<void>,
    statelessHeaders?: Record<string, string>,
  ): Promise<void> {
    const abortController = new AbortController();
    abortControllers.add(abortController);
    const signal = abortController.signal;
    try {
      if (frame.method !== 'initialize') await streamAnswered;
      const headers: Record<string, string> = {
        ...options.headers,
        ...(statelessHeaders ?? sessionHeaders(frame)),
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };

      const res = await (options.fetch ?? fetch)(url, {
        method: 'POST',
        redirect: 'error',
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

      const startedSession = frame.method === 'initialize' ? res.headers.get(SESSION_HEADER) : null;
      if (startedSession) {
        sessionId = startedSession;
        log.info('http-upstream-session');
      }
      // Followed before the result is relayed: the frame the client sends next waits for the stream's answer.
      const streamOfSession = startedSession && !signal.aborted ? notifications.follow(startedSession) : undefined;
      if (streamOfSession) streamAnswered = streamOfSession;

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        // SSE: parse `data: <json>` lines until the stream ends, forward each.
        if (res.body) await relaySseFrames(res.body, deliver, log);
      } else if (contentType.includes('application/json')) {
        // Single JSON response.
        const body = (await res.json()) as JsonRpcFrame;
        await deliver(body);
      }
      // Anything else (202 Accepted for a notification) carries no frame.
      await streamOfSession;
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

  /** The client's `initialize` as the server gets it: with the channel capability declared, when channels are served. */
  function toServer(initialize: JsonRpcFrame): JsonRpcFrame {
    return options.claudeCodeChannels ? declaringChannels(initialize) : initialize;
  }

  /** Forget what `server/discover` said once an `initialize` result disagrees: the next 2026-07-28 request asks again. */
  function refreshRevisions(initializeResult: unknown): void {
    if (revisions && revisions.pushesChannels !== advertisesChannels(initializeResult)) revisions = undefined;
  }

  /** Ask the server which revisions it speaks and whether it pushes channels; `undefined` when it does not say. */
  async function discoverRevisions(): Promise<ServerRevisions | undefined> {
    const request = discoverRequest(nextBridgeId('discover'));
    let result: unknown;
    try {
      await post(
        request,
        (frame) => {
          if (frame.id === request.id) result = frame.result;
        },
        DISCOVER_HEADERS,
      );
    } catch {
      return undefined;
    }
    return serverRevisionsOf(result);
  }

  /** Whether a 2026-07-28 frame was declined for a server that pushes channels: a request gets `-32022`, a notification is dropped. */
  async function declined(frame: JsonRpcFrame): Promise<boolean> {
    revisions ??= await discoverRevisions();
    if (!revisions?.pushesChannels) return false;
    if (frame.id !== undefined && frame.id !== null) {
      await onFrame(unsupportedProtocolVersion(frame, revisions.supported));
    }
    return true;
  }

  /** Send the client's `initialize`, and relay its result unchanged. */
  async function sendInitialize(initialize: JsonRpcFrame): Promise<void> {
    await post(toServer(initialize), async (frame) => {
      if (frame.id === initialize.id) refreshRevisions(frame.result);
      await onFrame(frame);
    });
  }

  return {
    async send(frame) {
      if (frame.method === 'initialize') return sendInitialize(frame);
      if (options.claudeCodeChannels && namesProtocol20260728(frame) && (await declined(frame))) return;
      await post(frame, onFrame);
    },
    async reinitialize(initialize, initialized) {
      const id = nextBridgeId('reinitialize');
      let response: JsonRpcFrame | undefined;
      await post({ ...toServer(initialize), id }, async (frame) => {
        if (frame.id === id) response = frame;
        else await onFrame(frame);
      });
      const result = resultOf(response, 'initialize');
      refreshRevisions(result);
      if (initialized) await post(initializedNotification(), onFrame);
      return result;
    },
    leaveSession() {
      sessionId = undefined;
      void notifications.follow(undefined);
    },
    async endSession() {
      const ending = sessionId;
      if (!ending) return;
      sessionId = undefined;
      void notifications.follow(undefined);
      try {
        const res = await (options.fetch ?? fetch)(url, {
          method: 'DELETE',
          redirect: 'error',
          headers: { ...options.headers, [SESSION_HEADER]: ending },
          signal: AbortSignal.timeout(END_SESSION_TIMEOUT_MS),
        });
        await res.body?.cancel();
      } catch (err) {
        log.warn('http-upstream-end-session-failed', { error: (err as Error).message });
      }
    },
    close: async () => {
      void notifications.follow(undefined);
      for (const ac of abortControllers) ac.abort();
      abortControllers.clear();
    },
  };
}

// ─── Pipe mode (--serve) ────────────────────────────────────────────────

export interface PipeUpstreamOptions extends UpstreamClientOptions {
  /** The spawned child; we write to / read from its IPC channel (FD 3). */
  child: ChildProcess;
  /** Called with each batch of dev events the child sends (`{ __frontmcp: 'dev-events', events }`). */
  onDevEvents?: (events: unknown[]) => void;
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
  const { log, child, onFrame, onDevEvents, reinitializeTimeoutMs = 10_000 } = options;
  const pending = new Map<string, (frame: JsonRpcFrame) => void>();

  function handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') {
      log.warn('pipe-upstream-non-object', { type: typeof msg });
      return;
    }
    // SDK control messages (`{ __frontmcp: 'ready' }`, the dev events) are not JSON-RPC.
    const control = msg as { __frontmcp?: unknown; events?: unknown };
    if (control.__frontmcp === 'dev-events' && Array.isArray(control.events)) onDevEvents?.(control.events);
    if (control.__frontmcp !== undefined) return;
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
      const id = nextBridgeId('reinitialize');
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
