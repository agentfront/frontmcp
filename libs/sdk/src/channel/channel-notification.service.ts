// file: libs/sdk/src/channel/channel-notification.service.ts

import { type FrontMcpLogger } from '../common';
import { supportsChannels, type NotificationService } from '../notification/notification.service';

/**
 * The MCP notification method for Claude Code channels.
 * This is an experimental extension, not part of the standard MCP spec.
 */
const CHANNEL_NOTIFICATION_METHOD = 'notifications/claude/channel';

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
  private readonly defaultMeta: Record<string, string>;

  constructor(
    private readonly notificationService: NotificationService,
    logger: FrontMcpLogger,
    defaultMeta?: Record<string, string>,
  ) {
    this.logger = logger.child('ChannelNotificationService');
    this.defaultMeta = defaultMeta ?? {};
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
   * Send a channel notification with the given channel name as source.
   * Only sends to sessions subscribed to this specific channel.
   *
   * @param channelName - The channel name (becomes the `source` attribute)
   * @param content - The notification content
   * @param additionalMeta - Additional metadata to include
   */
  send(channelName: string, content: string, additionalMeta?: Record<string, string>): void {
    const meta: ChannelNotificationMeta = {
      ...this.defaultMeta,
      ...(additionalMeta ?? {}),
      source: channelName,
    };
    this.sendToSubscribedSessions(content, meta);
  }
}
