// file: libs/sdk/src/channel/channel.instance.ts

import {
  EntryOwnerRef,
  ChannelContext,
  ChannelCtorArgs,
  ChannelEntry,
  ChannelKind,
  ChannelRecord,
  ChannelFunctionTokenRecord,
  FrontMcpLogger,
  ScopeEntry,
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import type { ChannelNotification } from '../common/metadata/channel.metadata';
import type { ChannelNotificationService } from './channel-notification.service';

/**
 * Concrete implementation of a channel that can receive events and push notifications.
 *
 * For service connector channels (source: { type: 'service' }), maintains a persistent
 * ChannelContext that is connected on init and disconnected on teardown.
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
  /** Replay buffer for events that arrive when no sessions are connected */
  private _replayBuffer: ChannelNotification[] = [];
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
      const sourceLabel =
        this.metadata.source.type === 'service'
          ? (this.metadata.source as { service: string }).service
          : this.metadata.source.type;
      logger.info(`Channel "${this.name}" connected (${sourceLabel})`);
    } catch (err) {
      this._serviceContext = undefined;
      logger.error(`Channel "${this.name}" service failed to connect`, { error: err });
    }
  }

  /**
   * Disconnect the service connector (called during scope teardown).
   */
  async disconnectService(): Promise<void> {
    if (!this._serviceContext) return;

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
  get replayBuffer(): readonly ChannelNotification[] {
    return this._replayBuffer;
  }

  /**
   * Push a notification to subscribed Claude Code sessions.
   *
   * **Session isolation:** If `targetSessionId` is provided, the notification is sent
   * ONLY to that specific session. This prevents session-scoped data (job results,
   * agent outputs) from leaking to other connected sessions.
   *
   * If `targetSessionId` is undefined, the notification goes to ALL subscribed sessions
   * (appropriate for global events like webhooks, file changes, etc.).
   *
   * @param content - The notification content
   * @param meta - Additional metadata
   * @param targetSessionId - If set, deliver ONLY to this session
   */
  pushNotification(content: string, meta?: Record<string, string>, targetSessionId?: string): void {
    // Merge static meta from channel metadata with per-notification meta.
    // source is always authoritative (set last to prevent overrides).
    const mergedMeta: Record<string, string> = {
      ...(this.staticMeta ?? {}),
      ...(meta ?? {}),
      source: this.name,
    };

    const notification: ChannelNotification = { content, meta: mergedMeta };

    // Buffer for replay if enabled (only for global events, not session-scoped)
    if (this.replayEnabled && !targetSessionId) {
      this._replayBuffer.push(notification);
      while (this._replayBuffer.length > this._maxReplayEvents) {
        this._replayBuffer.shift();
      }
    }

    if (!this._channelNotificationService) {
      return;
    }

    if (targetSessionId) {
      // Session-scoped delivery — only to the originating session
      this._channelNotificationService.sendToSession(targetSessionId, content, mergedMeta);
    } else {
      // Global delivery — to all subscribed sessions
      this._channelNotificationService.sendToSubscribedSessions(content, mergedMeta);
    }
  }

  /**
   * Replay buffered events to a specific session.
   * Called when a new Claude Code session connects and the channel has buffered events.
   *
   * @param sessionId - The session to replay events to
   * @returns Number of events replayed
   */
  replayBufferedEvents(sessionId: string): number {
    if (!this.replayEnabled || this._replayBuffer.length === 0 || !this._channelNotificationService) {
      return 0;
    }

    let count = 0;
    for (const notification of this._replayBuffer) {
      const replayMeta = { ...notification.meta, replayed: 'true' };
      this._channelNotificationService.sendToSession(sessionId, notification.content, replayMeta);
      count++;
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
        this.pushNotification(notification.content, notification.meta, targetSessionId);
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
