/**
 * Session Relay — serve a request on the node that owns its MCP session.
 *
 * In a distributed deployment the node that receives a request may not be the one
 * holding the session's transport. That node ({@link SessionRelay.forward}) publishes
 * the request to the owner's relay channel and streams the owner's response back to
 * its client. The owner ({@link SessionRelay.handleMessage} → `relay-request`) runs
 * the request through its own `http:request` flow — auth, quota, routing, the MCP
 * transport and every hook run there, exactly as for a request it received itself —
 * and publishes what it writes, frame by frame, to the relaying node's channel.
 *
 * Redis Pub/Sub delivers the messages one connection publishes in order, so the
 * frames of a response (`ack`, `head`, `data`…, `end`) arrive in the order written.
 *
 * Failure handling on the relaying node:
 * - the owner does not listen on its channel (publish reached no subscriber) or does
 *   not acknowledge within `ackTimeoutMs`, its heartbeat expires while it serves, or no
 *   frame (a `keepalive` included) arrives for three owner-check intervals: before any
 *   byte reached the client the request fails with {@link SessionOwnerUnreachableError}
 *   (503, retryable); after, the response is ended;
 * - the client goes away: the owner is told to cancel, which aborts the response there.
 *
 * On the owner, a response frame that cannot be published (Redis error, or the relaying
 * node no longer listens) aborts the response and reports an `error` frame: a response
 * with a lost frame is never completed.
 */

import { randomUUID } from '@frontmcp/utils';

import type { ServerRequest, ServerResponse } from '../../common';
import { SessionOwnerUnreachableError } from '../../errors/transport.errors';
import type {
  HaRelayMessage,
  RelayedHttpRequest,
  RelayResponseEvent,
  RequestRelayMessage,
  ResponseRelayMessage,
} from '../../ha/relay-messages';
import { rpcError } from '../transport.error';
import { createRelayedServerRequest, decodeRelayChunk, RelayServerResponse } from './relay-http';

/** Where the relaying node writes the owner's response (a Node / Express `ServerResponse`). */
export interface RelayResponseTarget {
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
  readonly writableFinished?: boolean;
  writeHead(status: number, headers: Record<string, string | string[]>): unknown;
  flushHeaders?(): void;
  write(chunk: Uint8Array | string): unknown;
  end(): unknown;
  once(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
}

interface RelayLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  verbose?(message: string, meta?: Record<string, unknown>): void;
}

export interface SessionRelayOptions {
  /** This node's machine ID. */
  nodeId: string;
  /** Publish a message to a node's relay channel; resolves to the number of receivers. */
  publish(nodeId: string, message: HaRelayMessage): Promise<number>;
  /** Whether a node's heartbeat is present. */
  isNodeAlive(nodeId: string): Promise<boolean>;
  /** Serve a request relayed to this node (runs it through the `http:request` flow). */
  serve(request: ServerRequest, response: ServerResponse): Promise<void>;
  /** How long the relaying node waits for the owner to acknowledge a request. @default 5000 */
  ackTimeoutMs?: number;
  /**
   * How often the relaying node checks the owner's heartbeat while it serves, and how often
   * the owner sends a `keepalive` frame. @default 10000
   */
  ownerCheckIntervalMs?: number;
  /** `Retry-After` given to a client whose request could not be relayed. @default 30 */
  retryAfterSeconds?: number;
  logger?: RelayLogger;
}

interface PendingRelay {
  ownerNodeId: string;
  onFrame(frame: ResponseRelayMessage): void;
  fail(reason: string): void;
}

interface ServingRelay {
  sourceNodeId: string;
  response: RelayServerResponse;
  send(event: RelayResponseEvent): void;
}

const DEFAULT_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_OWNER_CHECK_INTERVAL_MS = 10_000;
const DEFAULT_RETRY_AFTER_SECONDS = 30;
const MIN_KEEPALIVE_MS = 100;
const SILENT_CHECKS_BEFORE_FAILURE = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isServableRequest(message: RequestRelayMessage): boolean {
  return (
    typeof message.requestId === 'string' &&
    typeof message.sourceNodeId === 'string' &&
    typeof message.sessionId === 'string' &&
    typeof message.request === 'object' &&
    message.request !== null
  );
}

function keepaliveIntervalOf(message: RequestRelayMessage): number {
  const requested = message.keepaliveMs;
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return DEFAULT_OWNER_CHECK_INTERVAL_MS;
  return Math.max(MIN_KEEPALIVE_MS, requested);
}

export class SessionRelay {
  private readonly nodeId: string;
  private readonly ackTimeoutMs: number;
  private readonly ownerCheckIntervalMs: number;
  private readonly retryAfterSeconds: number;
  private readonly logger?: RelayLogger;
  /** Requests this node relayed, awaiting the owner's response frames. */
  private readonly pending = new Map<string, PendingRelay>();
  /** Requests this node is serving for other nodes. */
  private readonly serving = new Map<string, ServingRelay>();
  private closed = false;

  constructor(private readonly options: SessionRelayOptions) {
    this.nodeId = options.nodeId;
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.ownerCheckIntervalMs = options.ownerCheckIntervalMs ?? DEFAULT_OWNER_CHECK_INTERVAL_MS;
    this.retryAfterSeconds = options.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
    this.logger = options.logger;
  }

  /** Requests relayed from this node that are still in flight. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Requests this node is serving for other nodes. */
  get servingCount(): number {
    return this.serving.size;
  }

  /** The error a request gets when its session owner cannot serve it. */
  unreachable(ownerNodeId: string, reason: string): SessionOwnerUnreachableError {
    return new SessionOwnerUnreachableError(ownerNodeId, this.retryAfterSeconds, reason);
  }

  /**
   * Relay a request to the node that owns its session and write that node's response
   * to `response`. Resolves once the response is complete (or the client went away).
   *
   * @throws SessionOwnerUnreachableError when the owner could not serve the request and
   *   nothing has been written to `response` yet.
   */
  forward(
    ownerNodeId: string,
    sessionId: string,
    request: RelayedHttpRequest,
    response: RelayResponseTarget,
  ): Promise<void> {
    if (this.closed) return Promise.reject(this.unreachable(ownerNodeId, 'this node is shutting down'));

    const requestId = randomUUID();
    const sessionLabel = sessionId.slice(0, 20);

    return new Promise<void>((resolve, reject) => {
      let acked = false;
      let headWritten = false;
      let done = false;
      let lastFrameAt = Date.now();
      let ownerTimer: ReturnType<typeof setInterval> | undefined;

      const cleanup = (): void => {
        clearTimeout(ackTimer);
        if (ownerTimer) clearInterval(ownerTimer);
        response.removeListener('close', onClientClose);
        this.pending.delete(requestId);
      };

      const finish = (): void => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };

      const fail = (reason: string): void => {
        if (done) return;
        done = true;
        cleanup();
        this.logger?.warn(`[HA] Relay to session owner failed: ${reason}`, {
          sessionId: sessionLabel,
          ownerNodeId,
        });
        if (!headWritten && !response.headersSent) {
          reject(this.unreachable(ownerNodeId, reason));
          return;
        }
        // Part of the response already reached the client: end it there.
        if (!response.writableEnded) response.end();
        resolve();
      };

      const onClientClose = (): void => {
        if (done || response.writableFinished) return;
        done = true;
        cleanup();
        this.options
          .publish(ownerNodeId, { kind: 'relay-cancel', requestId, sourceNodeId: this.nodeId })
          .catch(() => undefined);
        resolve();
      };

      const checkOwner = async (): Promise<void> => {
        if (Date.now() - lastFrameAt >= this.ownerCheckIntervalMs * SILENT_CHECKS_BEFORE_FAILURE) {
          fail('the owner stopped sending the response');
          return;
        }
        try {
          if (!(await this.options.isNodeAlive(ownerNodeId))) fail('the owner stopped while serving the request');
        } catch {
          // Heartbeat unreadable (Redis hiccup) — keep waiting.
        }
      };

      const markAcked = (): void => {
        if (acked) return;
        acked = true;
        clearTimeout(ackTimer);
        ownerTimer = setInterval(() => void checkOwner(), this.ownerCheckIntervalMs);
        ownerTimer.unref?.();
      };

      const onFrame = (frame: ResponseRelayMessage): void => {
        if (done) return;
        lastFrameAt = Date.now();
        switch (frame.event) {
          case 'ack':
            markAcked();
            return;
          case 'keepalive':
            return;
          case 'head':
            markAcked();
            if (!response.headersSent) {
              response.writeHead(frame.status, frame.headers);
              response.flushHeaders?.();
            }
            headWritten = true;
            return;
          case 'data':
            response.write(decodeRelayChunk(frame));
            return;
          case 'end':
            if (!response.writableEnded) response.end();
            finish();
            return;
          case 'error':
            fail(`the owner could not serve the request: ${frame.message}`);
            return;
        }
      };

      // Declared before anything can settle the request: `cleanup` clears it.
      const ackTimer = setTimeout(
        () => fail(`the owner did not acknowledge the request within ${this.ackTimeoutMs}ms`),
        this.ackTimeoutMs,
      );
      ackTimer.unref?.();
      this.pending.set(requestId, { ownerNodeId, onFrame, fail });
      response.once('close', onClientClose);

      const message: RequestRelayMessage = {
        kind: 'relay-request',
        requestId,
        sourceNodeId: this.nodeId,
        sessionId,
        request,
        timestamp: Date.now(),
        keepaliveMs: this.ownerCheckIntervalMs,
      };
      this.logger?.verbose?.('[HA] Relaying request to session owner', { sessionId: sessionLabel, ownerNodeId });
      this.options.publish(ownerNodeId, message).then(
        (receivers) => {
          if (receivers === 0) fail('the owner does not listen on its relay channel');
        },
        (error: unknown) => fail(`publishing the request failed: ${errorMessage(error)}`),
      );
    });
  }

  /** Dispatch a request-relay message that arrived on this node's channel. */
  handleMessage(message: HaRelayMessage): void {
    switch (message.kind) {
      case 'relay-request':
        if (!isServableRequest(message)) {
          this.logger?.warn('[HA] Dropped a malformed relayed request');
          return;
        }
        this.serveRelayed(message).catch((error: unknown) => {
          this.logger?.warn('[HA] Serving a relayed request failed', { error: errorMessage(error) });
        });
        return;
      case 'relay-response': {
        const pending = this.pending.get(message.requestId);
        if (pending && pending.ownerNodeId === message.sourceNodeId) pending.onFrame(message);
        return;
      }
      case 'relay-cancel': {
        const serving = this.serving.get(message.requestId);
        if (serving && serving.sourceNodeId === message.sourceNodeId) serving.response.destroy();
        return;
      }
      default:
        return;
    }
  }

  /**
   * Stop relaying: requests relayed from this node fail (or end), and requests this
   * node serves for others are aborted after telling their node.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const pending of [...this.pending.values()]) pending.fail('this node is shutting down');
    for (const serving of [...this.serving.values()]) {
      if (!serving.response.writableEnded) {
        serving.send({ event: 'error', message: 'the owner is shutting down' });
        serving.response.destroy();
      }
    }
    this.serving.clear();
  }

  /** Owner side: serve a request another node relayed here, streaming the response back. */
  private async serveRelayed(message: RequestRelayMessage): Promise<void> {
    const { requestId, sourceNodeId } = message;
    let undeliverable = false;
    const publishFrame = (event: RelayResponseEvent): Promise<number> => {
      const frame = { kind: 'relay-response', requestId, sourceNodeId: this.nodeId, ...event } as ResponseRelayMessage;
      return this.options.publish(sourceNodeId, frame);
    };
    const abandon = (reason: string): void => {
      if (undeliverable) return;
      undeliverable = true;
      this.logger?.warn('[HA] Failed to publish a relayed response frame', { reason, targetNodeId: sourceNodeId });
      publishFrame({ event: 'error', message: reason }).catch(() => undefined);
      response.destroy();
    };
    const send = (event: RelayResponseEvent): void => {
      if (undeliverable) return;
      publishFrame(event).then(
        (receivers) => {
          if (receivers === 0) abandon('the relaying node no longer listens');
        },
        (error: unknown) => abandon(`publishing a response frame failed: ${errorMessage(error)}`),
      );
    };
    const response = new RelayServerResponse({
      head: (status, headers) => send({ event: 'head', status, headers }),
      data: (chunk) => send({ event: 'data', ...chunk }),
      end: () => send({ event: 'end' }),
    });

    if (this.closed) {
      send({ event: 'error', message: 'the owner is shutting down' });
      return;
    }
    send({ event: 'ack' });
    const keepaliveTimer = setInterval(() => send({ event: 'keepalive' }), keepaliveIntervalOf(message));
    keepaliveTimer.unref?.();
    this.serving.set(requestId, { sourceNodeId, response, send });

    try {
      const request = createRelayedServerRequest(message.request, sourceNodeId);
      await this.options.serve(request, response.asServerResponse());
    } catch (error) {
      this.logger?.warn('[HA] Serving a relayed request failed', {
        sessionId: message.sessionId.slice(0, 20),
        sourceNodeId,
        error: errorMessage(error),
      });
      if (!response.writableEnded && !response.destroyed && !response.headersSent) {
        response.status(500).json(rpcError('Internal error'));
      }
    } finally {
      clearInterval(keepaliveTimer);
      if (!response.writableEnded && !response.destroyed) response.end();
      this.serving.delete(requestId);
    }
  }
}
