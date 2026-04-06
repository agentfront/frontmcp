import { FuncType, Type } from '@frontmcp/di';
import { ChannelMetadata, ChannelNotification } from '../metadata/channel.metadata';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';
import { PublicMcpError } from '../../errors/mcp.error';

/**
 * Channel type definition (class or factory function).
 * Used in app/plugin metadata for defining channels.
 */
export type ChannelType<T = unknown> = Type<T> | FuncType<T>;

/**
 * Constructor arguments for ChannelContext.
 */
export type ChannelCtorArgs = ExecutionContextBaseArgs & {
  metadata: ChannelMetadata;
};

/**
 * Abstract base class for channel execution contexts.
 *
 * Channel contexts handle incoming events and transform them into
 * notifications that are pushed to Claude Code sessions.
 *
 * For **service connectors** (source: { type: 'service' }), channels maintain persistent
 * connections to external services. Claude sends messages via the channel's tools and
 * receives responses back through `onEvent()` as `notifications/claude/channel`.
 *
 * @example Simple webhook channel
 * ```typescript
 * @Channel({
 *   name: 'deploy-alerts',
 *   source: { type: 'webhook', path: '/hooks/deploy' },
 * })
 * class DeployChannel extends ChannelContext {
 *   async onEvent(payload: unknown): Promise<ChannelNotification> {
 *     return { content: `Deploy event received` };
 *   }
 * }
 * ```
 *
 * @example WhatsApp service connector
 * ```typescript
 * @Channel({
 *   name: 'whatsapp',
 *   source: { type: 'service', service: 'whatsapp-business' },
 *   tools: [SendWhatsAppTool],  // Claude calls this to send messages
 *   twoWay: true,
 * })
 * class WhatsAppChannel extends ChannelContext {
 *   private client: WhatsAppClient;
 *
 *   async onConnect(): Promise<void> {
 *     this.client = new WhatsAppClient(process.env['WA_TOKEN']);
 *     this.client.on('message', (msg) => {
 *       // Incoming messages trigger the notification pipeline
 *       this.pushIncoming({ sender: msg.from, text: msg.body, chatId: msg.chatId });
 *     });
 *     await this.client.connect();
 *   }
 *
 *   async onDisconnect(): Promise<void> {
 *     await this.client?.disconnect();
 *   }
 *
 *   async onEvent(payload: unknown): Promise<ChannelNotification> {
 *     const msg = payload as { sender: string; text: string; chatId: string };
 *     return {
 *       content: `${msg.sender}: ${msg.text}`,
 *       meta: { chat_id: msg.chatId, sender: msg.sender },
 *     };
 *   }
 * }
 * ```
 */
export abstract class ChannelContext extends ExecutionContextBase<ChannelNotification> {
  protected readonly channelName: string;
  readonly metadata: ChannelMetadata;

  /**
   * Callback for pushing incoming events from a service connection.
   * Set by ChannelInstance after construction for service connectors.
   * @internal
   */
  _pushIncoming?: (payload: unknown) => void;

  constructor(args: ChannelCtorArgs) {
    const { metadata, providers, logger } = args;
    super({
      providers,
      logger: logger.child(`channel:${metadata.name}`),
      authInfo: args.authInfo,
    });
    this.channelName = metadata.name;
    this.metadata = metadata;
  }

  /**
   * Receive an incoming event and transform it into a notification for Claude Code.
   *
   * This is the **inbound** handler — called when the channel's source receives an
   * external event (webhook POST, service message, app error, agent/job completion).
   * The returned `ChannelNotification` is pushed to all Claude Code sessions as a
   * `<channel>` tag.
   *
   * @param payload - The raw event payload from the external source
   * @returns A notification to push to Claude Code sessions
   */
  abstract onEvent(payload: unknown): Promise<ChannelNotification>;

  /**
   * Handle a reply from Claude Code (only called when twoWay is true).
   * Override this to forward replies to external systems (Slack, email, etc.).
   *
   * @param reply - The reply text from Claude
   * @param meta - Optional metadata from the reply tool call
   */
  async onReply(reply: string, meta?: Record<string, string>): Promise<void> {
    throw new PublicMcpError(
      `Channel "${this.channelName}" has twoWay: true but onReply() is not implemented. ` +
        `Override onReply() to forward replies to the external system.`,
      'CHANNEL_REPLY_NOT_IMPLEMENTED',
      501,
    );
  }

  /**
   * Establish a persistent connection to an external service.
   * Called during scope initialization for service connector channels.
   *
   * Override this to set up WebSocket connections, API clients, polling loops,
   * or any persistent service connection. Use `pushIncoming()` to feed incoming
   * messages into the notification pipeline.
   *
   * @example
   * ```typescript
   * async onConnect(): Promise<void> {
   *   this.client = new TelegramBot(process.env['BOT_TOKEN']);
   *   this.client.on('message', (msg) => {
   *     this.pushIncoming({ sender: msg.from.username, text: msg.text, chatId: msg.chat.id });
   *   });
   * }
   * ```
   */
  async onConnect(): Promise<void> {
    // Default: no-op. Override for service connectors.
  }

  /**
   * Tear down the persistent connection.
   * Called during scope shutdown for service connector channels.
   */
  async onDisconnect(): Promise<void> {
    // Default: no-op. Override for service connectors.
  }

  /**
   * Push an incoming event from a service connection into the notification pipeline.
   * This triggers `onEvent()` → notification push to all capable Claude Code sessions.
   *
   * Use this inside `onConnect()` when you receive events from persistent connections
   * (WebSocket messages, polling results, etc.).
   *
   * @param payload - The raw event payload to process through `onEvent()`
   */
  protected pushIncoming(payload: unknown): void {
    if (this._pushIncoming) {
      this._pushIncoming(payload);
    } else {
      this.logger.warn(`Channel "${this.channelName}": pushIncoming called but no handler is wired`);
    }
  }
}
