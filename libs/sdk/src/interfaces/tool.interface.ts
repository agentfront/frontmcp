import {randomUUID} from "crypto";
import {FuncType, Token, Type} from "./base.interface";
import {ProviderRegistryInterface} from "./internal";
import {ToolMetadata} from "../metadata";
import {FrontMcpLogger} from "./logger.interface";
import {FlowControl} from "./flow.interface";
import {URL} from "url";

export type ToolType<T = any> =
  | Type<T>
  | FuncType<T>

type HistoryEntry<T> = {
  at: number;
  stage?: string;
  value: T | undefined;
  note?: string;
};

export abstract class ToolContext<In, Out> {
  private providers: ProviderRegistryInterface;
  private session: any; // TODO: type this

  protected readonly runId: string;
  protected readonly toolId: string;
  protected readonly toolName: string;
  protected readonly metadata: ToolMetadata;
  protected readonly logger: FrontMcpLogger;

  protected activeStage: string;

  // ---- INPUT storages (backing fields)
  private _rawInput?: Partial<In> | any;
  private _input?: In;

  // ---- OUTPUT storages (backing fields)
  private _outputDraft?: Partial<Out> | any;
  private _output?: Out;

  private _error?: Error;

  // ---- histories
  private readonly _inputHistory: HistoryEntry<In>[] = [];
  private readonly _outputHistory: HistoryEntry<Out>[] = [];


  constructor(metadata: ToolMetadata, input: In, providers: ProviderRegistryInterface, logger: FrontMcpLogger, session: any) {
    this.runId = randomUUID();
    this.toolName = metadata.name;
    this.toolId = metadata.id ?? metadata.name;
    this.metadata = metadata;
    this._input = input;
    this.providers = providers;
    this.logger = logger.child(`tool:${this.toolId}`);
  }

  abstract execute(input: In): Promise<Out>;

  get<T>(token: Token<T>): T {
    return this.providers.get(token);
  }

  tryGet<T>(token: Token<T>): T | undefined {
    try {
      return this.providers.get(token);
    } catch (e) {
      this.logger.warn("Requesting provider that doesn't exist: ", token);
      return undefined;
    }
  }

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
    this._outputHistory.push({at: Date.now(), stage: this.activeStage, value: v,});
  }

  public get outputHistory(): ReadonlyArray<HistoryEntry<Out>> {
    return this._outputHistory;
  }

  protected respond(value: Out): never {
    // record validated output and surface the value via control flow
    this.output = value;
    FlowControl.respond<Out>(value);
  }

  /** Fail the run (invoker will run error/finalize). */
  protected fail(err: Error): never {
    this._error = err;
    FlowControl.fail(err);
  }

  mark(stage: string): void {
    this.activeStage = stage;
  }

  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return this.session.fetch(input, init);
  }
}

