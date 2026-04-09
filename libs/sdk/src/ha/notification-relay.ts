/**
 * Notification Relay — Redis Pub/Sub Cross-Pod Messaging
 *
 * Each pod subscribes to its own channel (`mcp:ha:notify:{nodeId}`).
 * When a notification targets a session on a different pod,
 * it's published to that pod's channel for local delivery.
 */

import { DEFAULT_HA_CONFIG, type HaConfig } from './ha.types';

/**
 * Notification message relayed between pods.
 */
export interface RelayMessage {
  /** Target session ID */
  sessionId: string;
  /** MCP notification to deliver */
  notification: {
    method: string;
    params?: Record<string, unknown>;
  };
  /** Source pod that originated the notification */
  sourceNodeId: string;
  /** Timestamp of relay */
  timestamp: number;
}

/**
 * Handler invoked when a relay message arrives for this pod.
 */
export type RelayHandler = (message: RelayMessage) => void | Promise<void>;

/**
 * Minimal Redis pub/sub client interface.
 * Requires a dedicated connection for subscribing (ioredis pattern).
 */
export interface RelayRedisClient {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  on(event: 'message', handler: (channel: string, message: string) => void): void;
  removeAllListeners(event: 'message'): void;
  removeListener(event: 'message', handler: (channel: string, message: string) => void): void;
}

export class NotificationRelay {
  private handler: RelayHandler | undefined;
  private readonly channel: string;
  private readonly keyPrefix: string;

  constructor(
    private readonly subscriber: RelayRedisClient,
    private readonly publisher: RelayRedisClient,
    private readonly nodeId: string,
    config?: Partial<HaConfig>,
  ) {
    this.keyPrefix = config?.redisKeyPrefix ?? DEFAULT_HA_CONFIG.redisKeyPrefix;
    this.channel = `${this.keyPrefix}notify:${nodeId}`;
  }

  /** Start listening for relay messages on this pod's channel. */
  async subscribe(handler: RelayHandler): Promise<void> {
    this.handler = handler;
    this.subscriber.on('message', this.onMessage);
    await this.subscriber.subscribe(this.channel);
  }

  /** Stop listening and clean up. */
  async unsubscribe(): Promise<void> {
    this.handler = undefined;
    this.subscriber.removeListener('message', this.onMessage);
    try {
      await this.subscriber.unsubscribe(this.channel);
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Publish a notification to a target pod's channel.
   * Used when a notification targets a session not owned by this pod.
   */
  async publish(targetNodeId: string, sessionId: string, notification: RelayMessage['notification']): Promise<void> {
    const targetChannel = `${this.keyPrefix}notify:${targetNodeId}`;
    const message: RelayMessage = {
      sessionId,
      notification,
      sourceNodeId: this.nodeId,
      timestamp: Date.now(),
    };
    await this.publisher.publish(targetChannel, JSON.stringify(message));
  }

  private onMessage = (_channel: string, raw: string): void => {
    if (!this.handler) return;
    try {
      const message = JSON.parse(raw) as RelayMessage;
      // Fire-and-forget — handler errors shouldn't crash the relay
      Promise.resolve(this.handler(message)).catch(() => {});
    } catch {
      // Malformed message — skip
    }
  };
}
