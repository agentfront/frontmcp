// file: libs/sdk/src/common/interfaces/prompt.interface.ts

import { type FuncType, type Type } from '@frontmcp/di';
import { type AuthInfo, type GetPromptResult } from '@frontmcp/protocol';

import { type PromptMetadata } from '../metadata';
import { type PromptEsmTargetRecord, type PromptRemoteRecord } from '../records/prompt.record';
import { ExecutionContextBase } from './execution-context.interface';
import { FlowControl } from './flow.interface';
import { type ProviderRegistryInterface } from './internal';
import { type FrontMcpLogger } from './logger.interface';

/** A message returned by a prompt; `role` is checked when the prompt runs, so a string literal needs no `as const`. */
export interface PromptMessageInput {
  role: string;
  content: Record<string, unknown>;
}

/** What a prompt's execute() may return; each form is turned into a GetPromptResult. */
export type PromptExecuteResult = string | PromptMessageInput[] | Record<string, unknown> | GetPromptResult;

export interface PromptInterface {
  execute(args: Record<string, string>): Promise<PromptExecuteResult>;
}

/**
 * Functional prompt pattern - returned by prompt() builder.
 * A callable that returns an execute handler, with metadata attached.
 */

export type FunctionalPromptType = (() => any) & { [key: symbol]: unknown };

export type PromptType =
  | Type<PromptInterface>
  | FuncType<PromptInterface>
  | FunctionalPromptType
  | string
  | PromptEsmTargetRecord
  | PromptRemoteRecord;

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

export abstract class PromptContext extends ExecutionContextBase<PromptExecuteResult> {
  protected readonly promptId: string;
  protected readonly promptName: string;
  readonly metadata: PromptMetadata;

  /** The arguments passed to the prompt */
  readonly args: Record<string, string>;

  // ---- OUTPUT storages (backing fields)
  private _output?: PromptExecuteResult;

  // ---- histories
  private readonly _outputHistory: HistoryEntry<PromptExecuteResult>[] = [];

  constructor(ctorArgs: PromptCtorArgs) {
    const { metadata, args, providers, logger, authInfo } = ctorArgs;
    // promptId uses the metadata name as the stable identifier for the prompt type
    // (runId is the unique instance identifier for this specific execution)
    super({ providers, logger: logger.child(`prompt:${metadata.name}`), authInfo });
    this.promptName = metadata.name;
    this.promptId = metadata.name;
    this.metadata = metadata;
    this.args = args;
  }

  abstract execute(args: Record<string, string>): Promise<PromptExecuteResult>;

  /** @deprecated Use `this.auth` or `this.context.authInfo` instead. */
  override get authInfo(): AuthInfo {
    return super.authInfo as AuthInfo;
  }

  public get output(): PromptExecuteResult | undefined {
    return this._output;
  }

  public set output(v: PromptExecuteResult | undefined) {
    this._output = v;
    this._outputHistory.push({ at: Date.now(), stage: this.activeStage, value: v });
  }

  public get outputHistory(): ReadonlyArray<HistoryEntry<PromptExecuteResult>> {
    return this._outputHistory;
  }

  respond(value: GetPromptResult): never {
    // record validated output and surface the value via control flow
    this.output = value;
    FlowControl.respond<GetPromptResult>(value);
  }

  /** Get the error that caused the prompt to fail, if any. */
  public override get error(): Error | undefined {
    return super.error;
  }
}
