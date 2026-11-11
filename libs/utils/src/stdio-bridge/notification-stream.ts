/**
 * The standalone notification stream of an MCP session over streamable HTTP: the `GET` a server answers with the
 * messages it starts itself, such as a channel event, `list_changed`, a log line or a resource update.
 */

import { relaySseFrames } from './sse-frames';
import type { JsonRpcFrame } from './stdio-framer';
import type { BridgeLogger } from './types';

export const SESSION_HEADER = 'mcp-session-id';

/** Statuses of a server that offers no stream, or no longer knows the session. */
const NO_STREAM_STATUSES = [404, 405];
/** How long `follow()` waits for the server to answer the stream's first `GET`. */
const OPEN_WAIT_MS = 2_000;
const FIRST_REOPEN_DELAY_MS = 250;
const MAX_REOPEN_DELAY_MS = 4_000;
/** How many opens in a row may fail before the stream is given up. */
const MAX_FAILED_OPENS = 5;

export interface NotificationStreamOptions {
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  log: BridgeLogger;
  /** Called for every frame the server sends on the stream. */
  onFrame: (frame: JsonRpcFrame) => void | Promise<void>;
}

export interface NotificationStream {
  /**
   * Relay the stream of `sessionId` and end the one relayed before; with no session, only end it. Resolves once
   * the server answered the stream's first `GET`, or after 2 s without an answer.
   */
  follow(sessionId: string | undefined): Promise<void>;
}

/** Wait `ms`, or until `signal` aborts; the wait never keeps the process running. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms).unref();
    signal.addEventListener('abort', finish, { once: true });
    /** End the wait, and leave no timer or listener behind. */
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

/** Relays one session's notification stream at a time, reopening it when it drops while the session lives. */
export function createNotificationStream(options: NotificationStreamOptions): NotificationStream {
  const { url, log, onFrame } = options;
  let following: AbortController | undefined;

  /** `GET` the session's stream: its body when the server streams, else whether the `GET` failed or it offers none. */
  async function open(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array> | 'failed' | 'unavailable'> {
    try {
      const response = await (options.fetch ?? fetch)(url, {
        method: 'GET',
        redirect: 'error',
        headers: { ...options.headers, accept: 'text/event-stream', [SESSION_HEADER]: sessionId },
        signal,
      });
      const streams = (response.headers.get('content-type') ?? '').includes('text/event-stream');
      if (response.ok && streams && response.body) return response.body;
      await response.body?.cancel();
      const offersNone = response.ok || NO_STREAM_STATUSES.includes(response.status);
      log.debug(offersNone ? 'notification-stream-unavailable' : 'notification-stream-failed', {
        status: response.status,
      });
      return offersNone ? 'unavailable' : 'failed';
    } catch (err) {
      if (!signal.aborted) log.debug('notification-stream-failed', { error: (err as Error).message });
      return 'failed';
    }
  }

  /** Relay an open stream until it ends or breaks, and say whether it relayed a frame. */
  async function relay(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<boolean> {
    let relayed = false;
    try {
      await relaySseFrames(
        body,
        async (frame) => {
          relayed = true;
          await onFrame(frame);
        },
        log,
      );
    } catch (err) {
      if (!signal.aborted) log.debug('notification-stream-dropped', { error: (err as Error).message });
    }
    return relayed;
  }

  /** Relay the stream until its session ends, the server offers none, or it can't be opened any more. */
  async function relayUntilEnded(sessionId: string, signal: AbortSignal, onAnswered: () => void): Promise<void> {
    let failedOpens = 0;
    let delayMs = FIRST_REOPEN_DELAY_MS;
    while (!signal.aborted) {
      const opened = await open(sessionId, signal);
      onAnswered();
      if (signal.aborted || opened === 'unavailable') return;
      if (opened === 'failed') {
        failedOpens += 1;
        if (failedOpens === MAX_FAILED_OPENS) {
          log.warn('notification-stream-lost', { attempts: failedOpens });
          return;
        }
      } else {
        failedOpens = 0;
        if (await relay(opened, signal)) delayMs = FIRST_REOPEN_DELAY_MS;
      }
      await pause(delayMs, signal);
      delayMs = Math.min(delayMs * 2, MAX_REOPEN_DELAY_MS);
    }
  }

  return {
    follow(sessionId) {
      following?.abort();
      following = undefined;
      if (!sessionId) return Promise.resolve();
      const stream = new AbortController();
      following = stream;
      return new Promise((answered) => {
        void relayUntilEnded(sessionId, stream.signal, answered);
        void pause(OPEN_WAIT_MS, stream.signal).then(answered);
      });
    },
  };
}
