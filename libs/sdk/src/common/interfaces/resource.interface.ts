// file: libs/sdk/src/common/interfaces/resource.interface.ts

import { randomUUID } from 'crypto';
import { ResourceMetadata, ResourceTemplateMetadata } from '../metadata';
import { FuncType, Token, Type } from './base.interface';
import { ProviderRegistryInterface } from './internal';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { URL } from 'url';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ScopeEntry } from '../entries';

export interface ResourceInterface<In = any, Out = any> {
  execute(uri: string, params: Record<string, string>): Promise<Out>;
}

export type ResourceType<In = any, Out = any> = Type<ResourceInterface<In, Out>> | FuncType<ResourceInterface<In, Out>>;

type HistoryEntry<T> = {
  at: number;
  stage?: string;
  value: T | undefined;
  note?: string;
};

export type ResourceCtorArgs = {
  metadata: ResourceMetadata | ResourceTemplateMetadata;
  uri: string;
  params: Record<string, string>;
  providers: ProviderRegistryInterface;
  logger: FrontMcpLogger;
  authInfo: AuthInfo;
};

export abstract class ResourceContext<In = any, Out = any> {
  private providers: ProviderRegistryInterface;
  readonly authInfo: AuthInfo;

  protected readonly runId: string;
  protected readonly resourceId: string;
  protected readonly resourceName: string;
  readonly metadata: ResourceMetadata | ResourceTemplateMetadata;
  protected readonly logger: FrontMcpLogger;

  /** The actual URI being read */
  readonly uri: string;
  /** Extracted URI template parameters (empty for static resources) */
  readonly params: Record<string, string>;

  protected activeStage = 'init';

  // ---- OUTPUT storages (backing fields)
  private _output?: Out;

  private _error?: Error;

  // ---- histories
  private readonly _outputHistory: HistoryEntry<Out>[] = [];

  constructor(args: ResourceCtorArgs) {
    const { metadata, uri, params, providers, logger, authInfo } = args;
    this.runId = randomUUID();
    this.resourceName = metadata.name;
    // resourceId uses the metadata name as the stable identifier for the resource type
    // (runId is the unique instance identifier for this specific execution)
    this.resourceId = metadata.name;
    this.metadata = metadata;
    this.uri = uri;
    this.params = params;
    this.providers = providers;
    this.logger = logger.child(`resource:${this.resourceId}`);
    this.authInfo = authInfo;
  }

  abstract execute(uri: string, params: Record<string, string>): Promise<Out>;

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
      this.logger.warn("Requesting provider that doesn't exist: ", token);
      return undefined;
    }
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

  /** Fail the run (invoker will run error/finalize). */
  protected fail(err: Error): never {
    this._error = err;
    FlowControl.fail(err);
  }

  mark(stage: string): void {
    this.activeStage = stage;
  }

  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }
}
