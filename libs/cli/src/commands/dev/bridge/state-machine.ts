/**
 * Bridge state machine (issue #399).
 *
 *   Idle → Booting → Ready ⇄ Reloading
 *                           ↓ deadline
 *                        Degraded
 *
 * Owns the request buffer that absorbs inbound JSON-RPC frames while the
 * upstream child is mid-restart. When buffered requests exceed the
 * configured cap (default 8), the FSM synthesises an immediate
 * `dev_buffer_full` response so clients never silently lose frames.
 *
 * The FSM is transport-agnostic — `child-supervisor` and `upstream-client`
 * call into it; this module never touches sockets, child processes, or
 * file descriptors.
 */

import { DEV_BUFFER_FULL, DEV_RELOAD_DEADLINE, DEV_SERVER_UNREACHABLE, makeDevError } from './errors';
import type { BridgeLogger } from './log';
import type { JsonRpcFrame } from './stdio-framer';

export type BridgeState = 'Idle' | 'Booting' | 'Ready' | 'Reloading' | 'Degraded' | 'Stopping';

export interface InflightRequest {
  /** Original frame (kept for replay if the child dies before responding). */
  frame: JsonRpcFrame;
  /** Wall-clock when the bridge forwarded the frame to upstream. */
  forwardedAt: number;
}

export interface BridgeStateMachineOptions {
  log: BridgeLogger;
  bufferSize: number;
  reloadDeadlineMs: number;
  /** Send a JSON-RPC frame back to the client (stdio out). */
  respond(frame: JsonRpcFrame): void | Promise<void>;
  /** Forward a request frame to the upstream child. Implemented by the supervisor. */
  forward(frame: JsonRpcFrame): void | Promise<void>;
}

export interface BridgeStateMachine {
  readonly state: BridgeState;
  /** Bridge has begun launching the child — buffer inbound frames. */
  onBootStart(): void;
  /** Child reports ready — drain the buffer through `forward`. */
  onChildReady(): void;
  /** Child exited unexpectedly. If we were Ready, transition to Reloading. */
  onChildExit(reason: string): void;
  /** Watcher fired. Buffer inbound, start reload timer. */
  onWatcherEvent(trigger: string): void;
  /** Reload deadline elapsed without a ready signal. */
  onReloadDeadline(): void;
  /** Inbound JSON-RPC frame from stdin. Routes to `forward` or buffers. */
  enqueue(frame: JsonRpcFrame): Promise<void>;
  /** Outbound JSON-RPC frame from upstream — relay to client. */
  relayUpstream(frame: JsonRpcFrame): Promise<void>;
  /** SIGTERM/SIGINT — flush buffer with `dev_server_unreachable` and stop. */
  stop(): Promise<void>;
  /** Number of frames currently buffered (testing hook). */
  bufferDepth(): number;
}

export function createBridgeStateMachine(options: BridgeStateMachineOptions): BridgeStateMachine {
  const { log, bufferSize, reloadDeadlineMs, respond, forward } = options;
  let state: BridgeState = 'Idle';
  const buffer: JsonRpcFrame[] = [];
  const inflight = new Map<string | number, InflightRequest>();
  let reloadTimer: NodeJS.Timeout | undefined;

  function transition(next: BridgeState, info?: Record<string, unknown>): void {
    if (state === next) return;
    log.info('state-transition', { from: state, to: next, ...info });
    state = next;
  }

  function clearReloadTimer(): void {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = undefined;
    }
  }

  async function flushBufferAsResponses(reason: string, data?: Record<string, unknown>): Promise<void> {
    while (buffer.length > 0) {
      const f = buffer.shift();
      if (!f) break;
      const id = f.id ?? null;
      // Notifications (no id) can't get a response — drop with a log line.
      if (id === null) {
        log.warn('drop-notification', { method: f.method, reason });
        continue;
      }
      await respond(makeDevError(id, DEV_SERVER_UNREACHABLE, { reason, ...data }));
    }
  }

  async function failInflightAsResponses(reason: string, data?: Record<string, unknown>): Promise<void> {
    for (const [id, req] of inflight) {
      const idVal = typeof id === 'number' ? id : (id as string);
      await respond(makeDevError(idVal, DEV_SERVER_UNREACHABLE, { reason, ...data, method: req.frame.method }));
    }
    inflight.clear();
  }

  return {
    get state() {
      return state;
    },
    bufferDepth: () => buffer.length,

    onBootStart() {
      transition('Booting');
    },

    onChildReady() {
      clearReloadTimer();
      transition('Ready', { bufferDepth: buffer.length });
      // Drain buffered requests in FIFO; preserve order on the wire.
      const drain = [...buffer];
      buffer.length = 0;
      void (async () => {
        for (const f of drain) {
          // Re-mark as inflight when forwarding; relayUpstream will clear it.
          if (typeof f.id === 'string' || typeof f.id === 'number') {
            inflight.set(f.id, { frame: f, forwardedAt: Date.now() });
          }
          try {
            await forward(f);
          } catch (err) {
            log.error('forward-failed', { error: (err as Error).message });
          }
        }
      })();
    },

    onChildExit(reason) {
      log.warn('child-exit', { reason, state });
      if (state === 'Stopping') return; // expected
      // Treat as a reload trigger if we were Ready; otherwise stay where we are.
      if (state === 'Ready' || state === 'Booting') {
        transition('Reloading', { trigger: 'child-exit', reason });
        // Inflight requests will never get a real response — synthesise one.
        void failInflightAsResponses('child_exit', { reason });
        scheduleReloadDeadline();
      } else if (state === 'Reloading') {
        // Two exits in a row — keep waiting for boot
      }
    },

    onWatcherEvent(trigger) {
      if (state === 'Stopping' || state === 'Degraded') return;
      log.reloadEvent('start', { trigger });
      transition('Reloading', { trigger });
      // Inflight requests will likely be killed when supervisor kills the
      // child. Respond now so the client spinner clears immediately.
      void failInflightAsResponses('reload', { trigger });
      scheduleReloadDeadline();
    },

    onReloadDeadline() {
      log.error('reload-deadline-elapsed', { bufferDepth: buffer.length });
      transition('Degraded', { reason: 'reload_deadline' });
      void flushBufferAsResponses('deadline');
    },

    async enqueue(frame: JsonRpcFrame) {
      const isRequest = frame.id !== undefined && frame.id !== null;

      if (state === 'Ready') {
        if (isRequest) {
          inflight.set(frame.id as string | number, { frame, forwardedAt: Date.now() });
        }
        try {
          await forward(frame);
        } catch (err) {
          log.error('forward-failed', { error: (err as Error).message });
          if (isRequest) {
            inflight.delete(frame.id as string | number);
            await respond(makeDevError(frame.id ?? null, DEV_SERVER_UNREACHABLE, { reason: 'forward_failed' }));
          }
        }
        return;
      }

      if (state === 'Degraded') {
        if (isRequest) {
          await respond(makeDevError(frame.id ?? null, DEV_SERVER_UNREACHABLE, { reason: 'degraded' }));
        }
        return;
      }

      // Idle / Booting / Reloading / Stopping → buffer
      if (buffer.length >= bufferSize) {
        if (isRequest) {
          await respond(makeDevError(frame.id ?? null, DEV_BUFFER_FULL, { capacity: bufferSize }));
        } else {
          log.warn('drop-notification', { method: frame.method, reason: 'buffer_full' });
        }
        return;
      }
      buffer.push(frame);
    },

    async relayUpstream(frame: JsonRpcFrame) {
      // Clear inflight if this is a response to a known id
      if (frame.id !== undefined && frame.id !== null && (frame.result !== undefined || frame.error !== undefined)) {
        inflight.delete(frame.id);
      }
      await respond(frame);
    },

    async stop() {
      transition('Stopping');
      clearReloadTimer();
      // Inflight + buffered: respond once so the client's pending RPCs don't
      // dangle past the bridge exit.
      await failInflightAsResponses('stopping');
      await flushBufferAsResponses('stopping');
    },
  };

  function scheduleReloadDeadline(): void {
    clearReloadTimer();
    reloadTimer = setTimeout(() => {
      if (state === 'Reloading' || state === 'Booting') {
        // Mark deadline reached — supervisor stays alive, watcher retries.
        log.error('reload-deadline-fired');
        transition('Degraded', { reason: 'reload_deadline' });
        // Drain buffer with deadline-shaped error.
        void (async () => {
          while (buffer.length > 0) {
            const f = buffer.shift();
            if (!f) break;
            const id = f.id ?? null;
            if (id === null) {
              log.warn('drop-notification', { method: f.method, reason: 'deadline' });
              continue;
            }
            await respond(makeDevError(id, DEV_RELOAD_DEADLINE, { deadlineMs: reloadDeadlineMs }));
          }
        })();
      }
    }, reloadDeadlineMs).unref();
  }
}
