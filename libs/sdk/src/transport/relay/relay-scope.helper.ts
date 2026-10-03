/**
 * Wire a scope's HA relay channel: request relay, remote session destroys and
 * relayed notifications. Kept out of `scope.instance.ts` so the scope stays lean.
 */

import type { ServerRequest, ServerResponse } from '../../common';
import type { HaManager, HaRelayMessage } from '../../ha';
import { isRequestRelayMessage } from '../../ha/relay-messages';
import type { RedisTransportBus } from '../bus/redis-transport-bus';
import type { TransportService } from '../transport.registry';
import { serveRelayedHttpRequest, type RelayFlowRunner } from './relay-flow';
import { SessionRelay } from './session-relay';

interface RelayScopeLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  verbose?(message: string, meta?: Record<string, unknown>): void;
}

export interface WireSessionRelayOptions {
  nodeId: string;
  haManager: HaManager;
  bus: RedisTransportBus;
  transportService: TransportService;
  notifications: {
    deliverRelayedNotification(sessionId: string, method: string, params?: Record<string, unknown>): boolean;
  };
  /** Runs relayed requests through the `http:request` flow (the scope). */
  flows: RelayFlowRunner;
  logger: RelayScopeLogger;
  /** Override the relay's acknowledgement timeout (ms). */
  ackTimeoutMs?: number;
}

export interface SessionRelayHandle {
  relay: SessionRelay;
  /** Resolves once this node listens on its relay channel (or the handle was closed). */
  ready: Promise<void>;
  /** Stop relaying and stop retrying the subscription. */
  close(): Promise<void>;
}

const SUBSCRIBE_RETRY_BASE_MS = 1_000;
const SUBSCRIBE_RETRY_MAX_MS = 30_000;

/**
 * Subscribe this node to its relay channel and attach a {@link SessionRelay} to the
 * transport bus. Returns `undefined` when the HA manager has no pub/sub connections.
 *
 * The subscription is retried with backoff (1s doubling to 30s) while Redis is
 * unreachable; until it succeeds the bus cannot relay, and a request for a session
 * another live node owns is answered with a retryable 503.
 */
export function wireSessionRelay(options: WireSessionRelayOptions): SessionRelayHandle | undefined {
  const { haManager, bus, transportService, notifications, logger, nodeId } = options;
  if (!haManager.getRelay()) return undefined;

  const config = haManager.getConfig();
  const relay = new SessionRelay({
    nodeId,
    publish: (target, message) => haManager.publishToNode(target, message),
    isNodeAlive: (target) => haManager.isNodeAlive(target),
    serve: (request: ServerRequest, response: ServerResponse) =>
      serveRelayedHttpRequest(options.flows, request, response),
    ackTimeoutMs: options.ackTimeoutMs,
    ownerCheckIntervalMs: config.heartbeatIntervalMs,
    retryAfterSeconds: Math.ceil(config.heartbeatTtlMs / 1000),
    logger,
  });

  const handler = (message: HaRelayMessage): void => {
    if (isRequestRelayMessage(message)) {
      relay.handleMessage(message);
      return;
    }
    if (message.kind === 'destroy-session') {
      transportService.destroyLocalSession(message.sessionId, message.reason).catch((error: unknown) => {
        logger.warn('[HA] Failed to destroy a session on request of another node', {
          sessionId: message.sessionId.slice(0, 20),
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }
    if (message.kind === undefined || message.kind === 'notification') {
      notifications.deliverRelayedNotification(
        message.sessionId,
        message.notification.method,
        message.notification.params,
      );
    }
  };

  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let settleReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    settleReady = resolve;
    const attempt = (failures: number): void => {
      if (closed) {
        resolve();
        return;
      }
      haManager.subscribeRelay(handler).then(
        () => {
          if (closed) {
            resolve();
            return;
          }
          bus.attachRelay(relay);
          logger.info('[HA] Request relay ready — sessions owned by other nodes are served through them');
          resolve();
        },
        (error: unknown) => {
          const delay = Math.min(SUBSCRIBE_RETRY_MAX_MS, SUBSCRIBE_RETRY_BASE_MS * 2 ** failures);
          logger.warn(`[HA] Relay channel subscription failed — retrying in ${delay}ms`, {
            error: error instanceof Error ? error.message : String(error),
          });
          retryTimer = setTimeout(() => attempt(failures + 1), delay);
          retryTimer.unref?.();
        },
      );
    };
    attempt(0);
  });

  return {
    relay,
    ready,
    close: async () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      settleReady();
      bus.attachRelay(undefined);
      await relay.close();
    },
  };
}
