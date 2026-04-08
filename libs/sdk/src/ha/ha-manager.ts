/**
 * HA Manager — Lifecycle Coordinator
 *
 * Orchestrates heartbeat, session takeover, and notification relay.
 * Created by Scope when deployment mode is 'distributed'.
 */

import { DEFAULT_HA_CONFIG, type HaConfig, type TakeoverResult } from './ha.types';
import { HeartbeatService, type HeartbeatRedisClient } from './heartbeat.service';
import { NotificationRelay, type RelayHandler, type RelayRedisClient } from './notification-relay';
import { attemptSessionTakeover, type TakeoverRedisClient } from './session-takeover';

/**
 * Options for creating an HaManager.
 */
export interface HaManagerOptions {
  /** Redis client for heartbeat and session operations */
  redis: HeartbeatRedisClient & TakeoverRedisClient;
  /** Dedicated Redis subscriber connection for pub/sub (required for relay) */
  pubsubSubscriber?: RelayRedisClient;
  /** Redis publisher connection (can reuse main redis client) */
  pubsubPublisher?: RelayRedisClient;
  /** This pod's machine ID */
  nodeId: string;
  /** HA configuration overrides */
  config?: Partial<HaConfig>;
  /** Logger (optional) */
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; debug: (msg: string) => void };
}

export class HaManager {
  private readonly heartbeat: HeartbeatService;
  private readonly relay: NotificationRelay | undefined;
  private readonly config: HaConfig;
  private readonly logger: HaManagerOptions['logger'];
  private started = false;

  private constructor(
    private readonly redis: HeartbeatRedisClient & TakeoverRedisClient,
    private readonly nodeId: string,
    options: HaManagerOptions,
  ) {
    this.config = { ...DEFAULT_HA_CONFIG, ...options.config };
    this.logger = options.logger;

    this.heartbeat = new HeartbeatService(redis, nodeId, this.config);

    if (options.pubsubSubscriber && options.pubsubPublisher) {
      this.relay = new NotificationRelay(options.pubsubSubscriber, options.pubsubPublisher, nodeId, this.config);
    }
  }

  /**
   * Create an HaManager instance.
   * Validates that required infrastructure (Redis) is available.
   */
  static create(options: HaManagerOptions): HaManager {
    if (!options.redis) {
      throw new Error(
        'Distributed mode requires Redis configuration. ' +
          'Add redis: { host: "...", port: 6379 } to your @FrontMcp() config.',
      );
    }
    return new HaManager(options.redis, options.nodeId, options);
  }

  /** Start heartbeat and notification relay. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.heartbeat.start();
    this.logger?.info(`[HA] Heartbeat started for node ${this.nodeId}`);

    if (this.relay) {
      this.logger?.info(`[HA] Notification relay started`);
    }
  }

  /** Stop all HA services. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    await this.heartbeat.stop();
    if (this.relay) {
      await this.relay.unsubscribe();
    }
    this.logger?.info(`[HA] Services stopped for node ${this.nodeId}`);
  }

  /**
   * Attempt to take over an orphaned session via atomic CAS.
   *
   * @param sessionKey - Full Redis key for the session
   * @param expectedOldNodeId - The dead pod's nodeId
   * @returns Whether this pod successfully claimed the session
   */
  async attemptTakeover(sessionKey: string, expectedOldNodeId: string): Promise<TakeoverResult> {
    const result = await attemptSessionTakeover(this.redis, sessionKey, expectedOldNodeId, this.nodeId);

    if (result.claimed) {
      this.logger?.info(`[HA] Took over session ${sessionKey} from ${expectedOldNodeId}`);
    } else {
      this.logger?.debug(`[HA] Session ${sessionKey} already claimed by another pod`);
    }

    return result;
  }

  /** Check if a specific node is alive. */
  async isNodeAlive(nodeId: string): Promise<boolean> {
    return this.heartbeat.isAlive(nodeId);
  }

  /** Get all alive node IDs. */
  async getAliveNodes(): Promise<string[]> {
    return this.heartbeat.getAliveNodes();
  }

  /** Get the notification relay (undefined if pub/sub not configured). */
  getRelay(): NotificationRelay | undefined {
    return this.relay;
  }

  /** Subscribe to relay messages (for cross-pod notification delivery). */
  async subscribeRelay(handler: RelayHandler): Promise<void> {
    if (this.relay) {
      await this.relay.subscribe(handler);
    }
  }

  /** Update the heartbeat with current session count. */
  setSessionCount(count: number): void {
    this.heartbeat.setSessionCount(count);
  }

  /** Whether HA services are running. */
  isStarted(): boolean {
    return this.started;
  }

  /** The node ID this manager is running for. */
  getNodeId(): string {
    return this.nodeId;
  }
}
