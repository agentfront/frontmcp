import { FuncType, Type } from './base.interface';
import { ProviderRegistryInterface } from './internal';
import { ToolInputType, ToolMetadata, ToolOutputType } from '../metadata';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ToolInputOf, ToolOutputOf } from '../decorators';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';
import type { AIPlatformType, ClientInfo } from '../../notification';

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

  constructor(args: ToolCtorArgs<In>) {
    const { metadata, input, providers, logger } = args;
    super({
      providers,
      logger: logger.child(`tool:${metadata.id ?? metadata.name}`),
      authInfo: args.authInfo,
    });
    this.toolName = metadata.name;
    this.toolId = metadata.id ?? metadata.name;
    this.metadata = metadata;
    this._input = input;
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
