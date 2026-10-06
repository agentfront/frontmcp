// file: libs/sdk/src/channel/channel-notification.service.ts

import { type FrontMcpLogger } from '../common';
import { supportsChannels, type NotificationService } from '../notification/notification.service';

/**
 * The MCP notification method for Claude Code channels.
 * This is an experimental extension, not part of the standard MCP spec.
 */
export const CHANNEL_NOTIFICATION_METHOD = 'notifications/claude/channel';

/**
 * Metadata accompanying a channel notification.
 *
 * `source` is the channel name and is required — it drives subscription
 * enforcement, so a missing source would let any caller bypass per-channel
 * isolation. Encoded as a TypeScript requirement so callers can't omit it
 * by accident; the runtime check remains as a defense-in-depth assertion.
 */
export interface ChannelNotificationMeta {
  source: string;
  [key: string]: string;
}

/** Receives the channel notifications a session-less stream listens to. */
export type ChannelStreamListener = (content: string, meta: ChannelNotificationMeta) => void;

/** What the `channels:send-notification` flow takes. */
export interface ChannelSendInput {
  channelName: string;
  content: string;
  meta?: Record<string, string>;
  /** Deliver to this session only. */
  targetSessionId?: string;
}

/**
 * Service responsible for sending channel notifications to subscribed Claude Code sessions.
 *
 * **Session-scoped delivery:** Notifications are ONLY sent to sessions that:
 * 1. Have `experimental: { 'claude/channel': {} }` in client capabilities
 * 2. Are subscribed to the specific channel via `subscribeChannel()`
 *
 * This prevents data leaking between sessions — each session only receives
 * notifications from channels it has explicitly subscribed to.
 */
export class ChannelNotificationService {
  private readonly logger: FrontMcpLogger;
  private readonly serverMeta: Readonly<Record<string, string>>;
  /** MCP 2026-07-28 `subscriptions/listen` streams, which have no session, by the channels they listen to. */
  private readonly streamListeners = new Set<{ channels: ReadonlySet<string>; deliver: ChannelStreamListener }>();

  /**
   * @param defaultMeta - The server's `channels.defaultMeta`, added under every notification's own meta.
   * @param sendThroughFlow - Runs the `channels:send-notification` flow; the scope passes it so that
   *   `send()` is hookable like every other channel notification.
   */
  constructor(
    private readonly notificationService: NotificationService,
    logger: FrontMcpLogger,
    defaultMeta?: Record<string, string>,
    private readonly sendThroughFlow?: (input: ChannelSendInput) => Promise<unknown>,
  ) {
    this.logger = logger.child('ChannelNotificationService');
    this.serverMeta = { ...(defaultMeta ?? {}) };
  }

  /** The server's `channels.defaultMeta`, added under every notification's own meta. */
  get defaultMeta(): Readonly<Record<string, string>> {
    return this.serverMeta;
  }

  /**
   * Send a channel notification to all sessions subscribed to this channel.
   * Only sends to sessions that both support channels AND are subscribed to
   * the specific channel name.
   *
   * @param content - The notification content
   * @param meta - Metadata (must include `source` for the channel name)
   */
  sendToSubscribedSessions(content: string, meta: ChannelNotificationMeta): void {
    const channelName = meta.source;
    if (!channelName) {
      this.logger.warn('Cannot send channel notification without source in meta');
      return;
    }

    for (const listener of this.streamListeners) {
      if (listener.channels.has(channelName)) listener.deliver(content, meta);
    }

    const subscribers = this.notificationService.getSubscribersForChannel(channelName);
    if (subscribers.length === 0) {
      this.logger.verbose(`No subscribers for channel "${channelName}", notification buffered only`);
      return;
    }

    for (const sessionId of subscribers) {
      const registered = this.notificationService.getRegisteredServer(sessionId);
      if (registered && supportsChannels(registered.clientCapabilities)) {
        this.notificationService.sendCustomNotification(
          CHANNEL_NOTIFICATION_METHOD,
          { content, meta },
          (session) => session.sessionId === sessionId,
        );
      }
    }

    this.logger.verbose(`Sent channel "${channelName}" notification to ${subscribers.length} subscriber(s)`);
  }

  /**
   * Deliver the global notifications of `channelNames` to a listener with no session: an MCP
   * 2026-07-28 `subscriptions/listen` stream. Session-targeted notifications never reach it.
   *
   * @returns A function that stops the delivery
   */
  listen(channelNames: readonly string[], deliver: ChannelStreamListener): () => void {
    const listener = { channels: new Set(channelNames), deliver };
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  /**
   * @deprecated Use sendToSubscribedSessions instead. This method now delegates to
   * subscription-aware delivery.
   */
  sendToAllCapableSessions(content: string, meta: ChannelNotificationMeta): void {
    this.sendToSubscribedSessions(content, meta);
  }

  /**
   * Send a channel notification to a specific session (if it supports channels
   * and is subscribed to the channel).
   *
   * @param sessionId - The target session
   * @param content - The notification content
   * @param meta - Metadata key-value pairs
   * @returns true if the notification was sent
   */
  sendToSession(sessionId: string, content: string, meta: ChannelNotificationMeta): boolean {
    const registered = this.notificationService.getRegisteredServer(sessionId);
    if (!registered) {
      this.logger.warn(`Cannot send channel notification to unregistered session: ${sessionId.slice(0, 20)}...`);
      return false;
    }

    if (!supportsChannels(registered.clientCapabilities)) {
      this.logger.verbose(`Session ${sessionId.slice(0, 20)}... does not support channels, skipping`);
      return false;
    }

    // Targeted sends MUST carry a `meta.source` so subscription enforcement can
    // run. Letting messages through without it would let any caller bypass the
    // subscription check, so missing-source is treated as a programming error
    // and we fail closed rather than emitting an unfiltered notification.
    const channelName = meta.source;
    if (!channelName) {
      this.logger.error(
        `Channel notification rejected for session ${sessionId.slice(0, 20)}...: meta.source is required`,
      );
      return false;
    }
    if (!this.notificationService.isChannelSubscribed(sessionId, channelName)) {
      this.logger.verbose(`Session ${sessionId.slice(0, 20)}... not subscribed to channel "${channelName}", skipping`);
      return false;
    }

    this.notificationService.sendCustomNotification(
      CHANNEL_NOTIFICATION_METHOD,
      { content, meta },
      (session) => session.sessionId === sessionId,
    );
    return true;
  }

  /**
   * Send a channel notification with the given channel name as source, to the sessions subscribed to
   * that channel. It runs the hookable `channels:send-notification` flow, which adds
   * `channels.defaultMeta` and the channel's own `meta` and delivers it. A failure is logged, not thrown.
   *
   * `sendToSubscribedSessions()` and `sendToSession()` deliver directly, without the flow.
   *
   * @param channelName - The channel name (becomes the `source` attribute)
   * @param content - The notification content
   * @param additionalMeta - Additional metadata to include
   */
  async send(channelName: string, content: string, additionalMeta?: Record<string, string>): Promise<void> {
    if (!this.sendThroughFlow) {
      // Not wired to a scope (constructed on its own): deliver right away.
      this.sendToSubscribedSessions(content, { ...this.serverMeta, ...(additionalMeta ?? {}), source: channelName });
      return;
    }
    try {
      await this.sendThroughFlow({ channelName, content, meta: additionalMeta });
    } catch (error) {
      this.logger.error(`Channel "${channelName}" notification failed`, { error });
    }
  }
}
