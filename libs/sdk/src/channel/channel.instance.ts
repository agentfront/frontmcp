// file: libs/sdk/src/channel/channel.instance.ts

import {
  ChannelContext,
  ChannelEntry,
  ChannelKind,
  FrontMcpLogger,
  type ChannelCtorArgs,
  type ChannelFunctionTokenRecord,
  type ChannelRecord,
  type EntryOwnerRef,
  type ScopeEntry,
} from '../common';
import type { ChannelNotification } from '../common/metadata/channel.metadata';
import type ProviderRegistry from '../provider/provider.registry';
import type { ChannelNotificationService, SentChannelNotification } from './channel-notification.service';
import { wireFileWatcherSource } from './sources/file-watcher.source';

/**
 * Concrete implementation of a channel that can receive events and push notifications.
 *
 * For service connector channels (source: { type: 'service' }), maintains a persistent
 * ChannelContext that is connected on init and disconnected on teardown. A file-watcher
 * channel is connected the same way, and its declared paths are watched while it is, unless
 * it defines its own onConnect().
 *
 * **Scope Binding:** The ChannelInstance captures its scope and providers at construction time.
 */
export class ChannelInstance extends ChannelEntry {
  /** The provider registry this channel is bound to */
  private readonly _providers: ProviderRegistry;
  /** The scope this channel operates in */
  readonly scope: ScopeEntry;
  /** The notification service for pushing to Claude Code sessions */
  private _channelNotificationService?: ChannelNotificationService;
  /** Persistent context for service connectors (kept alive for the lifetime of the scope) */
  private _serviceContext?: ChannelContext;
  /** Ends the watch of a file-watcher source's paths; set while the channel is connected */
  private _stopFileWatch?: () => void;
  /** The channel's latest global notifications, kept for `replayBufferedEvents()` when replay is enabled */
  private _replayBuffer: SentChannelNotification[] = [];
  /** Maximum replay buffer size */
  private readonly _maxReplayEvents: number;

  constructor(record: ChannelRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this._providers = providers;
    this.name = record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this._providers.getActiveScope();
    this._maxReplayEvents = record.metadata.replay?.maxEvents ?? 50;
    this.ready = this.initialize();
  }

  /**
   * Set the notification service reference (injected after registry init).
   */
  setNotificationService(service: ChannelNotificationService): void {
    this._channelNotificationService = service;
  }

  get providers(): ProviderRegistry {
    return this._providers;
  }

  /**
   * Whether this channel requires a persistent connection via onConnect()/onDisconnect().
   * True for service connectors and file watchers.
   */
  get isServiceConnector(): boolean {
    return this.metadata.source.type === 'service' || this.metadata.source.type === 'file-watcher';
  }

  protected async initialize(): Promise<void> {
    // Channel initialization is lightweight — no hooks to validate
  }

  /**
   * Connect the service connector (called after notification service is wired).
   * Creates a persistent context, wires pushIncoming, and calls onConnect().
   * A file-watcher source then starts watching its declared paths, unless the channel connects itself.
   */
  async connectService(): Promise<void> {
    if (!this.isServiceConnector) return;

    const logger = this._providers.get(FrontMcpLogger);
    const ctx = this.create({});

    // Wire pushIncoming to route incoming service events through handleEvent
    ctx._pushIncoming = (payload: unknown) => {
      this.handleEvent(payload).catch((err) => {
        logger.error(`Channel "${this.name}" service: pushIncoming failed`, { error: err });
      });
    };

    try {
      await ctx.onConnect();
      this._serviceContext = ctx;
      const { source } = this.metadata;
      if (source.type === 'file-watcher') this._stopFileWatch = wireFileWatcherSource(this, ctx, source, logger);
      const sourceLabel = source.type === 'service' ? source.service : source.type;
      logger.info(`Channel "${this.name}" connected (${sourceLabel})`);
    } catch (err) {
      this._serviceContext = undefined;
      logger.error(`Channel "${this.name}" service failed to connect`, { error: err });
      throw err;
    }
  }

  /**
   * Disconnect the service connector (called during scope teardown).
   * The watch of a file-watcher source ends first.
   */
  async disconnectService(): Promise<void> {
    if (!this._serviceContext) return;
    this._stopFileWatch?.();
    this._stopFileWatch = undefined;

    const logger = this._providers.get(FrontMcpLogger);
    try {
      await this._serviceContext.onDisconnect();
      logger.info(`Channel "${this.name}" service disconnected`);
    } catch (err) {
      logger.error(`Channel "${this.name}" service failed to disconnect`, { error: err });
    }
    this._serviceContext = undefined;
  }

  /**
   * Get the persistent service context (for service connectors only).
   */
  get serviceContext(): ChannelContext | undefined {
    return this._serviceContext;
  }

  /**
   * Create a ChannelContext for handling an event.
   */
  create(authInfo: Partial<Record<string, unknown>>): ChannelContext {
    const logger = this._providers.get(FrontMcpLogger);
    const ctorArgs: ChannelCtorArgs = {
      metadata: this.metadata,
      providers: this._providers,
      logger,
      authInfo,
    };

    switch (this.record.kind) {
      case ChannelKind.FUNCTION: {
        const fnRecord = this.record as ChannelFunctionTokenRecord;
        const handler = fnRecord.provide();
        return new FunctionChannelContext(ctorArgs, handler);
      }
      case ChannelKind.CLASS_TOKEN: {
        // Class-based channel: instantiate directly (same pattern as ToolInstance)
        return new this.record.provide(ctorArgs) as ChannelContext;
      }
      default:
        throw new Error(`Unknown channel kind: ${(this.record as { kind: string }).kind}`);
    }
  }

  /**
   * Whether replay buffering is enabled for this channel.
   */
  get replayEnabled(): boolean {
    return this.metadata.replay?.enabled === true;
  }

  /**
   * Get the current replay buffer contents (read-only).
   */
  get replayBuffer(): readonly SentChannelNotification[] {
    return this._replayBuffer;
  }

  /**
   * Push a notification to subscribed Claude Code sessions, through the hookable
   * `channels:send-notification` flow. The flow adds the server's `channels.defaultMeta` and this
   * channel's `meta` under the notification's own, buffers it for replay, and delivers it. A failure
   * is logged, not thrown.
   *
   * **Session isolation:** If `targetSessionId` is provided, the notification is sent
   * ONLY to that specific session. This prevents session-scoped data (job results,
   * agent outputs) from leaking to other connected sessions.
   *
   * If `targetSessionId` is undefined, the notification goes to ALL subscribed sessions
   * (appropriate for global events like webhooks, file changes, etc.).
   *
   * @param content - The notification content
   * @param meta - Additional metadata; a value that is not a string is sent as one
   * @param targetSessionId - If set, deliver ONLY to this session
   */
  async pushNotification(content: string, meta?: Record<string, unknown>, targetSessionId?: string): Promise<void> {
    try {
      await this.scope.runFlow('channels:send-notification', {
        channelName: this.name,
        content,
        meta,
        ...(targetSessionId ? { targetSessionId } : {}),
      });
    } catch (err) {
      this._providers.get(FrontMcpLogger).error(`Channel "${this.name}" failed to send a notification`, { error: err });
    }
  }

  /**
   * Keep a delivered global notification for sessions that connect later (when replay is enabled).
   * Called by the `channels:send-notification` flow.
   *
   * @internal
   */
  recordForReplay(notification: SentChannelNotification): void {
    if (!this.replayEnabled) return;
    this._replayBuffer.push(notification);
    while (this._replayBuffer.length > this._maxReplayEvents) {
      this._replayBuffer.shift();
    }
  }

  /**
   * Send the buffered notifications to one session, each with `replayed: 'true'` in its meta.
   * Nothing in the SDK calls it when a session connects: call it yourself, such as from a tool the session calls.
   * Each call sends the whole buffer again.
   *
   * @param sessionId - The session to replay events to
   * @returns How many the session was sent: none when it is not connected, cannot take the channel, or its
   *   credentials have expired
   */
  replayBufferedEvents(sessionId: string): number {
    if (!this.replayEnabled || this._replayBuffer.length === 0 || !this._channelNotificationService) {
      return 0;
    }

    let count = 0;
    for (const notification of this._replayBuffer) {
      const replayMeta = { ...notification.meta, replayed: 'true' };
      if (this._channelNotificationService.sendToSession(sessionId, notification.content, replayMeta)) count++;
    }

    return count;
  }

  /**
   * Clear the replay buffer.
   */
  clearReplayBuffer(): void {
    this._replayBuffer = [];
  }

  /**
   * Handle an incoming event from the channel's source.
   * Creates a context, transforms the payload, and pushes the notification.
   *
   * @param payload - The raw event payload from the source
   * @param targetSessionId - If set, deliver notification ONLY to this session
   *   (prevents session-scoped data from leaking to other sessions)
   * @returns The notification that was sent (or null if transform failed)
   */
  async handleEvent(payload: unknown, targetSessionId?: string): Promise<ChannelNotification | null> {
    try {
      const ctx = this._serviceContext ?? this.create({});
      const notification = await ctx.onEvent(payload);
      if (notification) {
        await this.pushNotification(notification.content, notification.meta, targetSessionId);
      }
      return notification;
    } catch (err) {
      const logger = this._providers.get(FrontMcpLogger);
      logger.error(`Channel "${this.name}" failed to handle event`, { error: err });
      return null;
    }
  }

  /**
   * Handle a reply from Claude Code (for two-way channels).
   *
   * @throws What `onReply()` throws, so the `channel-reply` tool reports the failure to the caller.
   */
  async handleReply(reply: string, meta?: Record<string, string>): Promise<void> {
    if (!this.twoWay) {
      return;
    }
    try {
      const ctx = this._serviceContext ?? this.create({});
      await ctx.onReply(reply, meta);
    } catch (err) {
      const logger = this._providers.get(FrontMcpLogger);
      logger.error(`Channel "${this.name}" failed to handle reply`, { error: err });
      throw err;
    }
  }
}

/**
 * Minimal ChannelContext implementation for function-based channels.
 */
class FunctionChannelContext extends ChannelContext {
  private readonly handler: (
    payload: unknown,
    ctx?: ChannelContext,
  ) => ChannelNotification | Promise<ChannelNotification>;

  constructor(
    args: ChannelCtorArgs,
    handler: (payload: unknown, ctx?: ChannelContext) => ChannelNotification | Promise<ChannelNotification>,
  ) {
    super(args);
    this.handler = handler;
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return this.handler(payload, this);
  }
}
