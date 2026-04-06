// file: libs/sdk/src/common/interfaces/resource.interface.ts

import { Type } from '@frontmcp/di';
import { ResourceMetadata, ResourceTemplateMetadata } from '../metadata';
import { FlowControl } from './flow.interface';
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
 * Result returned by a resource argument completer.
 */
export interface ResourceCompletionResult {
  /** Completion suggestions matching the partial value */
  values: string[];
  /** Total number of matching values (for pagination) */
  total?: number;
  /** Whether more results exist beyond what was returned */
  hasMore?: boolean;
}

/**
 * Function that provides completion suggestions for a resource template argument.
 * @param partial - The partial value typed so far
 * @returns Completion suggestions
 */
export type ResourceArgumentCompleter = (
  partial: string,
) => Promise<ResourceCompletionResult> | ResourceCompletionResult;

/**
 * Function-style resource type.
 * This represents resources created via resource() or resourceTemplate() builders.
 * The function returns a handler that will be invoked for the resource.
 */
export type FunctionResourceType = (...args: any[]) => any;

/**
 * Type for resource class or function.
 * Supports both class-based resources (implementing ResourceInterface)
 * and function-style resources (created via resource/resourceTemplate builders).
 *
 * @template Params - Type for URI template parameters
 * @template Out - Type for the resource output
 */
export type ResourceType<Params extends Record<string, string> = Record<string, string>, Out = unknown> =
  | Type<ResourceInterface<Params, Out>>
  | FunctionResourceType
  | string;

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

  /**
   * Override to provide autocompletion for resource template arguments.
   * Called by the MCP `completion/complete` handler when a client requests
   * suggestions for a template parameter.
   *
   * There are two ways to provide completions (both have full DI access via `this.get()`):
   *
   * 1. **Convention-based (preferred):** Define a method named `${argName}Completer`.
   *    The framework auto-discovers these methods.
   *    ```typescript
   *    async accountNameCompleter(partial: string): Promise<ResourceCompletionResult> {
   *      const service = this.get(MyService);
   *      const accounts = await service.listAccounts();
   *      return { values: accounts.map(a => a.name).filter(n => n.startsWith(partial)) };
   *    }
   *    ```
   *
   * 2. **Override-based:** Override this method for dynamic dispatch.
   *    ```typescript
   *    getArgumentCompleter(argName: string): ResourceArgumentCompleter | null {
   *      if (argName === 'userId') {
   *        return async (partial) => ({
   *          values: await this.get(UserService).search(partial),
   *        });
   *      }
   *      return null;
   *    }
   *    ```
   *
   * @param argName - The template parameter name (e.g., 'userId')
   * @returns A completer function, or null if no completion is available for this argument
   */
  getArgumentCompleter(_argName: string): ResourceArgumentCompleter | null {
    return null;
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

  /**
   * Notify subscribers that this resource's content has changed.
   * Only sessions subscribed via `resources/subscribe` receive the notification.
   *
   * @param uri - Optional URI to notify about. Defaults to `this.uri`.
   */
  notifyUpdated(uri?: string): void {
    const targetUri = uri ?? this.uri;
    this.scope.notifications.notifyResourceUpdated(targetUri);
  }

  respond(value: Out): never {
    // record validated output and surface the value via control flow
    this.output = value;
    FlowControl.respond<Out>(value);
  }
}
