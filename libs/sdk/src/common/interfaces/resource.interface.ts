// file: libs/sdk/src/common/interfaces/resource.interface.ts

import { ResourceMetadata, ResourceTemplateMetadata } from '../metadata';
import { FuncType, Type } from './base.interface';
import { ProviderRegistryInterface } from './internal';
import { FrontMcpLogger } from './logger.interface';
import { FlowControl } from './flow.interface';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';

/**
 * Base interface for resource implementations.
 * @template Params - Type for URI template parameters (defaults to generic string record)
 * @template Out - Type for the resource output
 */
export interface ResourceInterface<Params extends Record<string, string> = Record<string, string>, Out = unknown> {
  execute(uri: string, params: Params): Promise<Out>;
}

/**
 * Type for resource class or function.
 * @template Params - Type for URI template parameters
 * @template Out - Type for the resource output
 */
export type ResourceType<Params extends Record<string, string> = Record<string, string>, Out = unknown> =
  | Type<ResourceInterface<Params, Out>>
  | FuncType<ResourceInterface<Params, Out>>;

type HistoryEntry<T> = {
  at: number;
  stage?: string;
  value: T | undefined;
  note?: string;
};

export type ResourceCtorArgs<Params extends Record<string, string> = Record<string, string>> =
  ExecutionContextBaseArgs & {
    metadata: ResourceMetadata | ResourceTemplateMetadata;
    uri: string;
    params: Params;
  };

/**
 * Abstract base class for resource execution contexts.
 * @template Params - Type for URI template parameters (e.g., `{ userId: string }`)
 * @template Out - Type for the resource output
 */
export abstract class ResourceContext<
  Params extends Record<string, string> = Record<string, string>,
  Out = unknown,
> extends ExecutionContextBase<Out> {
  protected readonly resourceId: string;
  protected readonly resourceName: string;
  readonly metadata: ResourceMetadata | ResourceTemplateMetadata;

  /** The actual URI being read */
  readonly uri: string;
  /** Extracted URI template parameters (empty for static resources) */
  readonly params: Params;

  // ---- OUTPUT storages (backing fields)
  private _output?: Out;

  // ---- histories
  private readonly _outputHistory: HistoryEntry<Out>[] = [];

  constructor(args: ResourceCtorArgs<Params>) {
    const { metadata, uri, params, providers, logger } = args;
    super({
      providers,
      logger: logger.child(`resource:${metadata.name}`),
      authInfo: args.authInfo,
    });
    this.resourceName = metadata.name;
    // resourceId uses the metadata name as the stable identifier for the resource type
    // (runId is the unique instance identifier for this specific execution)
    this.resourceId = metadata.name;
    this.metadata = metadata;
    this.uri = uri;
    this.params = params;
  }

  abstract execute(uri: string, params: Params): Promise<Out>;

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
