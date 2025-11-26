// file: libs/sdk/src/common/interfaces/prompt.interface.ts

import { randomUUID } from 'crypto';
import { PromptMetadata } from '../metadata';
import { FuncType, Token, Type } from './base.interface';
import { ProviderRegistryInterface } from './internal';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ScopeEntry } from '../entries';
import { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

export interface PromptInterface {
  execute(args: Record<string, string>): Promise<GetPromptResult>;
}

export type PromptType = Type<PromptInterface> | FuncType<PromptInterface>;

type HistoryEntry<T> = {
  at: number;
  stage?: string;
  value: T | undefined;
  note?: string;
};

export type PromptCtorArgs = {
  metadata: PromptMetadata;
  args: Record<string, string>;
  providers: ProviderRegistryInterface;
  logger: FrontMcpLogger;
  authInfo: AuthInfo;
};

export abstract class PromptContext {
  private providers: ProviderRegistryInterface;
  readonly authInfo: AuthInfo;

  protected readonly runId: string;
  protected readonly promptId: string;
  protected readonly promptName: string;
  readonly metadata: PromptMetadata;
  protected readonly logger: FrontMcpLogger;

  /** The arguments passed to the prompt */
  readonly args: Record<string, string>;

  protected activeStage = 'init';

  // ---- OUTPUT storages (backing fields)
  private _output?: GetPromptResult;

  private _error?: Error;

  // ---- histories
  private readonly _outputHistory: HistoryEntry<GetPromptResult>[] = [];

  constructor(ctorArgs: PromptCtorArgs) {
    const { metadata, args, providers, logger, authInfo } = ctorArgs;
    this.runId = randomUUID();
    this.promptName = metadata.name;
    // promptId uses the metadata name as the stable identifier for the prompt type
    // (runId is the unique instance identifier for this specific execution)
    this.promptId = metadata.name;
    this.metadata = metadata;
    this.args = args;
    this.providers = providers;
    this.logger = logger.child(`prompt:${this.promptId}`);
    this.authInfo = authInfo;
  }

  abstract execute(args: Record<string, string>): Promise<GetPromptResult>;

  get<T>(token: Token<T>): T {
    return this.providers.get(token);
  }

  get scope(): ScopeEntry {
    return this.providers.getScope();
  }

  tryGet<T>(token: Token<T>): T | undefined {
    try {
      return this.providers.get(token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to get provider ${String(token)}: ${msg}`);
      return undefined;
    }
  }

  public get output(): GetPromptResult | undefined {
    return this._output;
  }

  public set output(v: GetPromptResult | undefined) {
    this._output = v;
    this._outputHistory.push({ at: Date.now(), stage: this.activeStage, value: v });
  }

  public get outputHistory(): ReadonlyArray<HistoryEntry<GetPromptResult>> {
    return this._outputHistory;
  }

  respond(value: GetPromptResult): never {
    // record validated output and surface the value via control flow
    this.output = value;
    FlowControl.respond<GetPromptResult>(value);
  }

  /** Get the error that caused the prompt to fail, if any. */
  public get error(): Error | undefined {
    return this._error;
  }

  /** Fail the run (invoker will run error/finalize). */
  protected fail(err: Error): never {
    this._error = err;
    FlowControl.fail(err);
  }

  mark(stage: string): void {
    this.activeStage = stage;
  }
}
