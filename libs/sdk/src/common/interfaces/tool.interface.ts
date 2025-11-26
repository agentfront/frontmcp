import { FuncType, Type } from './base.interface';
import { ProviderRegistryInterface } from './internal';
import { ToolInputType, ToolMetadata, ToolOutputType } from '../metadata';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ToolInputOf, ToolOutputOf } from '../decorators';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';

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
}
