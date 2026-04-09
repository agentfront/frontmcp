/**
 * HA Manager — Lifecycle Coordinator
 *
 * Orchestrates heartbeat, session takeover, notification relay,
 * and orphan session scanning.
 * Created by Scope when deployment mode is 'distributed'.
 */

import { HaConfigurationError } from '../errors';
import { DEFAULT_HA_CONFIG, type HaConfig, type TakeoverResult } from './ha.types';
import { HeartbeatService, type HeartbeatRedisClient } from './heartbeat.service';
import { NotificationRelay, type RelayHandler, type RelayRedisClient } from './notification-relay';
import { attemptSessionTakeover, type TakeoverRedisClient } from './session-takeover';

/**
 * Callback invoked when an orphaned session is successfully claimed.
 */
export type OrphanHandler = (sessionId: string, previousNodeId: string) => void | Promise<void>;

/**
 * Options for the orphan session scanner.
 */
export interface OrphanScannerOptions {
  /** Redis key prefix for session keys (e.g., 'mcp:transport:'). */
  sessionKeyPrefix: string;
  /** Callback when a session is successfully claimed. */
  onOrphan: OrphanHandler;
  /**
   * Protocols that can be recreated after takeover.
   * Sessions with protocols NOT in this list are skipped (e.g., SSE sessions
   * cannot be recreated because the SSE stream is tied to the original connection).
   * @default ['streamable-http']
   */
  recreatableProtocols?: string[];
}

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
  private scannerBootstrapTimer: ReturnType<typeof setTimeout> | undefined;
  private scannerTimer: ReturnType<typeof setInterval> | undefined;
  private scannerOptions: OrphanScannerOptions | undefined;
  private scanning = false;
  private scannerStarted = false;

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
      throw new HaConfigurationError(
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
      this.logger?.info(`[HA] Notification relay available`);
    }
  }

  /**
   * Start the orphan session scanner.
   *
   * Runs periodically (on heartbeat interval) to detect sessions owned by
   * dead nodes and claim them via atomic Lua CAS. The `onOrphan` callback
   * is fired for each successfully claimed session.
   *
   * @param options - Scanner configuration
   */
  startOrphanScanner(options: OrphanScannerOptions): void {
    if (this.scannerStarted) return;
    this.scannerStarted = true;
    this.scannerOptions = options;

    // Run first scan after one full heartbeat interval + grace period
    // (allow heartbeats to stabilize before scanning)
    const delay = this.config.heartbeatIntervalMs + this.config.takeoverGracePeriodMs;

    this.scannerBootstrapTimer = setTimeout(() => {
      if (!this.started || !this.scannerStarted) return;
      void this.runOrphanScan();
      this.scannerTimer = setInterval(() => void this.runOrphanScan(), this.config.heartbeatIntervalMs);
      this.scannerTimer.unref?.();
    }, delay);
    this.scannerBootstrapTimer.unref?.();

    this.logger?.info(`[HA] Orphan scanner started (interval: ${this.config.heartbeatIntervalMs}ms)`);
  }

  /** Stop all HA services. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.scannerBootstrapTimer) {
      clearTimeout(this.scannerBootstrapTimer);
      this.scannerBootstrapTimer = undefined;
    }
    if (this.scannerTimer) {
      clearInterval(this.scannerTimer);
      this.scannerTimer = undefined;
    }
    this.scannerStarted = false;

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

  /**
   * Run a single orphan scan cycle.
   *
   * 1. Get alive nodes from heartbeat keys
   * 2. Scan session keys matching the configured prefix
   * 3. Parse each session's nodeId
   * 4. If nodeId is not in the alive set, attempt takeover
   * 5. Fire onOrphan callback for each claimed session
   */
  private async runOrphanScan(): Promise<void> {
    if (!this.scannerOptions || this.scanning) return;
    this.scanning = true;

    try {
      const aliveNodes = new Set(await this.heartbeat.getAliveNodes());

      // Skip scan if we can't determine alive nodes (Redis issue)
      if (aliveNodes.size === 0) {
        this.logger?.debug('[HA] Orphan scan skipped: no alive nodes detected (Redis may be unavailable)');
        return;
      }

      const { sessionKeyPrefix, onOrphan, recreatableProtocols } = this.scannerOptions;
      const allowedProtocols = new Set(recreatableProtocols ?? ['streamable-http']);
      const sessionKeys = await this.redis.keys(`${sessionKeyPrefix}*`);

      let claimed = 0;
      let scanned = 0;

      for (const key of sessionKeys) {
        scanned++;
        try {
          const raw = await this.redis.get(key);
          if (!raw) continue;

          const data = JSON.parse(raw);
          const sessionNodeId = data?.session?.nodeId ?? data?.nodeId;
          if (!sessionNodeId) continue;

          // Skip sessions with non-recreatable protocols (e.g., SSE)
          const protocol = data?.session?.protocol;
          if (protocol && !allowedProtocols.has(protocol)) continue;

          // Skip sessions owned by alive nodes (including ourselves)
          if (aliveNodes.has(sessionNodeId)) continue;

          // Dead node — attempt takeover
          const result = await attemptSessionTakeover(this.redis, key, sessionNodeId, this.nodeId);
          if (result.claimed) {
            claimed++;
            const sessionId = key.slice(sessionKeyPrefix.length);
            this.logger?.info(`[HA] Orphan scan: claimed session ${sessionId.slice(0, 20)} from ${sessionNodeId}`);

            // Fire callback (best-effort)
            try {
              await Promise.resolve(onOrphan(sessionId, sessionNodeId));
            } catch (err) {
              this.logger?.warn(`[HA] Orphan handler error for ${sessionId.slice(0, 20)}: ${err}`);
            }
          }
        } catch {
          // Skip individual session errors — continue scanning
        }
      }

      if (scanned > 0) {
        this.logger?.debug(`[HA] Orphan scan complete: scanned=${scanned}, claimed=${claimed}`);
      }
    } catch (err) {
      this.logger?.warn(`[HA] Orphan scan failed: ${err}`);
    } finally {
      this.scanning = false;
    }
  }
}
