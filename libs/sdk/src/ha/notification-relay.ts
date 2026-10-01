/**
 * Notification Relay — Redis Pub/Sub Cross-Pod Messaging
 *
 * Each pod subscribes to its own channel (`mcp:ha:notify:{nodeId}`).
 * Other pods publish to it to deliver a notification to a session it owns,
 * ask it to destroy a session, or relay an HTTP request for one of its
 * sessions (see {@link HaRelayMessage}).
 */

import { DEFAULT_HA_CONFIG, type HaConfig } from './ha.types';
import type { HaRelayMessage, NotificationRelayMessage } from './relay-messages';

/**
 * Notification message relayed between pods.
 */
export type RelayMessage = NotificationRelayMessage;

/**
 * Handler invoked when a message arrives on this pod's relay channel.
 */
export type RelayHandler = (message: HaRelayMessage) => void | Promise<void>;

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
    this.channel = this.channelOf(nodeId);
  }

  /** The relay channel of a node. */
  channelOf(nodeId: string): string {
    return `${this.keyPrefix}notify:${nodeId}`;
  }

  /** Start listening for relay messages on this pod's channel. */
  async subscribe(handler: RelayHandler): Promise<void> {
    this.handler = handler;
    this.subscriber.removeListener('message', this.onMessage);
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
  async publish(
    targetNodeId: string,
    sessionId: string,
    notification: NotificationRelayMessage['notification'],
  ): Promise<void> {
    await this.send(targetNodeId, {
      kind: 'notification',
      sessionId,
      notification,
      sourceNodeId: this.nodeId,
      timestamp: Date.now(),
    });
  }

  /**
   * Publish any relay message to a target pod's channel.
   * @returns How many subscribers received it — 0 when nothing listens on that pod's channel.
   */
  async send(targetNodeId: string, message: HaRelayMessage): Promise<number> {
    return this.publisher.publish(this.channelOf(targetNodeId), JSON.stringify(message));
  }

  private onMessage = (channel: string, raw: string): void => {
    if (!this.handler || channel !== this.channel) return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return; // Malformed message — skip
    }
    if (!message || typeof message !== 'object') return;
    // Fire-and-forget — handler errors shouldn't crash the relay
    try {
      Promise.resolve(this.handler(message as HaRelayMessage)).catch(() => undefined);
    } catch {
      // A synchronous handler error is dropped the same way
    }
  };
}
