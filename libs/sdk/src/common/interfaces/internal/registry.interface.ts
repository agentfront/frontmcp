import {
  ScopeEntry,
  FlowEntry,
  AuthProviderEntry,
  AppEntry,
  ProviderEntry,
  PluginEntry,
  AdapterEntry,
  PromptEntry,
  ResourceEntry,
  ToolEntry,
  LoggerEntry,
  EntryOwnerRef,
  HookEntry,
} from '../../entries';
import { Token } from '../base.interface';
import { FrontMcpAuth } from './primary-auth-provider.interface';
import { FlowName } from '../../metadata';
import { FlowCtxOf, FlowInputOf, FlowStagesOf } from '../flow.interface';
import { HookRecord } from '../../records';

export interface ScopeRegistryInterface {
  getScopes(): ScopeEntry[];
}

export interface FlowRegistryInterface {
  getFlows(): FlowEntry<FlowName>[];
}

export interface HookRegistryInterface {
  /**
   * used to pull hooks registered by a class and related to that class only,
   * like registering hooks on specific tool execution
   * @param token
   */
  getClsHooks(token: Token): HookEntry[];

  /**
   * Used to pull all hooks registered to specific flow by name,
   * this is used to construct the flow graph and execute hooks in order
   * @param flow
   */
  getFlowHooks<Name extends FlowName>(
    flow: Name,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[];

  /**
   * Used to pull all hooks registered to specific flow and stage by name,
   * this is used to construct the flow graph and execute hooks in order
   * @param flow
   * @param stage
   */
  getFlowStageHooks<Name extends FlowName>(
    flow: Name,
    stage: FlowStagesOf<Name> | string,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[];

  /**
   * Used to pull hooks for a specific flow, optionally filtered by owner ID.
   * Returns all hooks if no ownerId is provided, or only hooks belonging to
   * the specified owner or global hooks (no owner) if ownerId is provided.
   * @param flow
   * @param ownerId
   */
  getFlowHooksForOwner<Name extends FlowName>(
    flow: Name,
    ownerId?: string,
  ): HookEntry<FlowInputOf<Name>, Name, FlowStagesOf<Name>, FlowCtxOf<Name>>[];

  registerHooks(embedded: boolean, ...records: HookRecord[]): Promise<void[]>;
}

export interface ProviderViews {
  /** App-wide singletons, created at boot. Immutable from invokes POV. */
  global: ReadonlyMap<Token, unknown>;
  /** Session-scoped cache for this sessionId. Mutable. */
  session: Map<Token, unknown>;
  /** Request-scoped providers for this single invocation. Mutable. */
  request: Map<Token, unknown>;
}

export interface ProviderRegistryInterface {
  get<T>(token: Token<T>): T;

  getScope(): ScopeEntry;

  getProviders(): ProviderEntry[];

  getRegistries<T extends RegistryKind>(type: T): RegistryType[T][];

  // TODO: fix session type
  buildViews(session: any): Promise<ProviderViews>;
}

export interface AuthRegistryInterface {
  getPrimary(): FrontMcpAuth;

  getAuthProviders(): AuthProviderEntry[];
}

export interface AppRegistryInterface {
  getApps(): AppEntry[];
}

export interface PluginRegistryInterface {
  getPlugins(): PluginEntry[];
}

export interface AdapterRegistryInterface {
  getAdapters(): AdapterEntry[];
}

export interface ToolRegistryInterface {
  owner: EntryOwnerRef;

  // inline tools plus discovered by nested tool registries
  getTools(includeHidden?: boolean): ToolEntry[];

  // inline tools only
  getInlineTools(): ToolEntry<any, any>[];
}

export interface ResourceRegistryInterface {
  // owner of this registry
  owner: EntryOwnerRef;

  // inline resources plus discovered by nested resource registries
  getResources(includeHidden?: boolean): ResourceEntry<any, any>[];

  // resource templates
  getResourceTemplates(): ResourceEntry<any, any>[];

  // inline resources only
  getInlineResources(): ResourceEntry<any, any>[];

  // find a resource by URI (exact match first, then template matching)
  findResourceForUri(uri: string): { instance: ResourceEntry<any, any>; params: Record<string, string> } | undefined;
}

export interface PromptRegistryInterface {
  // owner reference for the registry
  owner: EntryOwnerRef;

  // inline prompts plus discovered by nested prompt registries
  getPrompts(includeHidden?: boolean): PromptEntry[];

  // inline prompts only
  getInlinePrompts(): PromptEntry[];

  // find a prompt by name
  findByName(name: string): PromptEntry | undefined;
}

export interface LoggerRegistryInterface {
  getLoggers(): LoggerEntry[];
}

export type GlobalRegistryKind = 'LoggerRegistry' | 'ScopeRegistry';

export type ScopedRegistryKind = 'AppRegistry' | 'AuthRegistry' | 'FlowRegistry' | 'HookRegistry';

export type AppRegistryKind =
  | 'ProviderRegistry'
  | 'PluginRegistry'
  | 'AdapterRegistry'
  | 'ToolRegistry'
  | 'PromptRegistry'
  | 'ResourceRegistry';

export type RegistryKind = GlobalRegistryKind | ScopedRegistryKind | AppRegistryKind;

export type RegistryType = {
  LoggerRegistry: LoggerRegistryInterface;
  ScopeRegistry: ScopeRegistryInterface;
  FlowRegistry: FlowRegistryInterface;
  HookRegistry: HookRegistryInterface;
  AppRegistry: AppRegistryInterface;
  AuthRegistry: AuthRegistryInterface;
  ProviderRegistry: ProviderRegistryInterface;
  PluginRegistry: PluginRegistryInterface;
  AdapterRegistry: AdapterRegistryInterface;
  ToolRegistry: ToolRegistryInterface;
  ResourceRegistry: ResourceRegistryInterface;
  PromptRegistry: PromptRegistryInterface;
};
