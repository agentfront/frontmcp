import { FuncType, Type } from '@frontmcp/di';
import { ProviderRegistryInterface } from './internal';
import { ToolInputType, ToolMetadata, ToolOutputType } from '../metadata';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ToolInputOf, ToolOutputOf } from '../decorators';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';
import type { AIPlatformType, ClientInfo, McpLoggingLevel } from '../../notification';

export type ToolType<T = any> = Type<T> | FuncType<T>;

type HistoryEntry<T> = {
  at: number;
  stage?: string;
  value: T | undefined;
  note?: string;
};

export type ToolCtorArgs<In> = ExecutionContextBaseArgs & {
  metadata: ToolMetadata;
  input: In;
  /** Progress token from the request's _meta, used for progress notifications */
  progressToken?: string | number;
};

export abstract class ToolContext<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends ExecutionContextBase<Out> {
  protected readonly toolId: string;
  protected readonly toolName: string;
  readonly metadata: ToolMetadata;

  // ---- INPUT storages (backing fields)
  private _rawInput?: Partial<In> | any;
  private _input?: In;

  // ---- OUTPUT storages (backing fields)
  private _outputDraft?: Partial<Out> | any;
  private _output?: Out;

  // ---- histories
  private readonly _inputHistory: HistoryEntry<In>[] = [];
  private readonly _outputHistory: HistoryEntry<Out>[] = [];

  // ---- Progress token from request's _meta (for progress notifications)
  private readonly _progressToken?: string | number;

  constructor(args: ToolCtorArgs<In>) {
    const { metadata, input, providers, logger, progressToken } = args;
    super({
      providers,
      logger: logger.child(`tool:${metadata.id ?? metadata.name}`),
      authInfo: args.authInfo,
    });
    this.toolName = metadata.name;
    this.toolId = metadata.id ?? metadata.name;
    this.metadata = metadata;
    this._input = input;
    this._progressToken = progressToken;
  }

  abstract execute(input: In): Promise<Out>;

  public get input(): In {
    return this._input as In;
  }

  public set input(v: In | undefined) {
    this._input = v;
    this._inputHistory.push({
      at: Date.now(),
      stage: this.activeStage,
      value: v,
    });
  }

  public get inputHistory(): ReadonlyArray<HistoryEntry<In>> {
    return this._inputHistory;
  }

  public get output(): Out | undefined {
    return this._output;
  }

  public set output(v: Out | undefined) {
    this._output = v;
    this._outputHistory.push({ at: Date.now(), stage: this.activeStage, value: v });
  }

  public get outputHistory(): ReadonlyArray<HistoryEntry<Out>> {
    return this._outputHistory;
  }

  respond(value: Out): never {
    // record validated output and surface the value via control flow
    this.output = value;
    FlowControl.respond<Out>(value);
  }

  // ============================================
  // Notification Methods
  // ============================================

  /**
   * Send a notification message to the current session.
   * Uses 'notifications/message' per MCP 2025-11-25 spec.
   *
   * @param message - The notification message (string) or structured data (object)
   * @param level - Log level: 'debug', 'info', 'warning', or 'error' (default: 'info')
   * @returns true if the notification was sent, false if session unavailable
   *
   * @example
   * ```typescript
   * async execute(input: Input): Promise<Output> {
   *   await this.notify('Starting processing...', 'info');
   *   await this.notify({ step: 1, total: 5, status: 'in_progress' });
   *   // ... processing
   *   await this.notify('Processing complete', 'info');
   *   return result;
   * }
   * ```
   */
  protected async notify(message: string | Record<string, unknown>, level: McpLoggingLevel = 'info'): Promise<boolean> {
    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      this.logger.warn('Cannot send notification: no session ID');
      return false;
    }

    const data = typeof message === 'string' ? { message } : message;
    return this.scope.notifications.sendLogMessageToSession(sessionId, level, this.toolName, data);
  }

  /**
   * Send a progress notification to the current session.
   * Uses 'notifications/progress' per MCP 2025-11-25 spec.
   *
   * Only works if the client requested progress updates by including a
   * progressToken in the request's _meta field. If no progressToken was
   * provided, this method logs a debug message and returns false.
   *
   * @param progress - Current progress value (should increase monotonically)
   * @param total - Total progress value (optional)
   * @param message - Progress message (optional)
   * @returns true if the notification was sent, false if no progressToken or session
   *
   * @example
   * ```typescript
   * async execute(input: Input): Promise<Output> {
   *   const items = input.items;
   *   for (let i = 0; i < items.length; i++) {
   *     await this.progress(i + 1, items.length, `Processing item ${i + 1}`);
   *     await processItem(items[i]);
   *   }
   *   return { processed: items.length };
   * }
   * ```
   */
  protected async progress(progress: number, total?: number, message?: string): Promise<boolean> {
    if (!this._progressToken) {
      this.logger.debug('Cannot send progress: no progressToken in request');
      return false;
    }

    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      this.logger.warn('Cannot send progress: no session ID');
      return false;
    }

    return this.scope.notifications.sendProgressNotification(sessionId, this._progressToken, progress, total, message);
  }

  // ============================================
  // Platform Detection API
  // ============================================

  /**
   * Get the detected AI platform type for the current session.
   * This is auto-detected from the client info during MCP initialization.
   *
   * Use this to customize tool responses (e.g., UI format) based on the calling platform.
   *
   * @returns The detected platform type, or 'unknown' if not detected
   * @example
   * ```typescript
   * async execute(input: Input): Promise<Output> {
   *   const platform = this.platform;
   *   if (platform === 'openai') {
   *     // Return OpenAI-specific response format
   *   }
   *   // ...
   * }
   * ```
   */
  get platform(): AIPlatformType {
    // First check sessionIdPayload (detected from user-agent during session creation)
    const payloadPlatform = this.authInfo.sessionIdPayload?.platformType;
    if (payloadPlatform && payloadPlatform !== 'unknown') {
      return payloadPlatform;
    }

    // Fall back to notification service (detected from MCP clientInfo during initialize)
    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      return 'unknown';
    }
    return this.scope.notifications.getPlatformType(sessionId);
  }

  /**
   * Get the client info (name and version) for the current session.
   * This is captured from the MCP initialize request.
   *
   * @returns The client info, or undefined if not available
   * @example
   * ```typescript
   * async execute(input: Input): Promise<Output> {
   *   const client = this.clientInfo;
   *   console.log(`Called by: ${client?.name} v${client?.version}`);
   *   // ...
   * }
   * ```
   */
  get clientInfo(): ClientInfo | undefined {
    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      return undefined;
    }
    return this.scope.notifications.getClientInfo(sessionId);
  }
}
