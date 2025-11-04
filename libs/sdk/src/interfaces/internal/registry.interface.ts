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
  ToolEntry, LoggerEntry,
} from '../../entries';
import { Token } from '../base.interface';
import { EntryOwnerRef } from '../../entries/base.entry';
import { FrontMcpAuth } from './primary-auth-provider.interface';
import { FlowName } from '../../metadata';

export interface ScopeRegistryInterface {
  getScopes(): ScopeEntry[];
}

export interface FlowRegistryInterface {
  getFlows(): FlowEntry<FlowName>[];
}


export interface ProviderViews {
  /** App-wide singletons, created at boot. Immutable from invoke’s POV. */
  global: ReadonlyMap<Token, unknown>;
  /** Session-scoped cache for this sessionId. Mutable. */
  session: Map<Token, unknown>;
  /** Request-scoped providers for this single invocation. Mutable. */
  request: Map<Token, unknown>;
}


export interface ProviderRegistryInterface {
  get<T>(token: Token<T>): T;

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

  //
  // // nested adapters
  // getAdapters(): AdapterEntry[];
  //
  // // plugin tools plus nested adapter's tools
  // getTools(): ToolEntry<any, any>[];
  //
  // // plugin resources plus nested adapter's tools
  // getResources(): ResourceEntry[];
  //
  // // plugin prompts plus nested adapter's tools
  // getPrompts(): PromptEntry[];
}

export interface AdapterRegistryInterface {
  getAdapters(): AdapterEntry[];

  //
  // // nested tools
  // getTools(): ToolEntry<any, any>[];
  //
  // getResources(): ResourceEntry[];
  //
  // getPrompts(): PromptEntry[];
}

export interface ToolRegistryInterface {
  owner: EntryOwnerRef;

  // inline tools plus discovered by nested tool registries
  getTools(): ToolEntry<any, any>[];

  // inline tools only
  getInlineTools(): ToolEntry<any, any>[];
}


export interface ResourceRegistryInterface {
  // inline resources plus discovered by nested tool registries
  getResources(): ResourceEntry<any, any>[];

  // inline resources only
  getInlineResources(): ResourceEntry<any, any>[];
}


export interface PromptRegistryInterface {
  // inline prompts plus discovered by nested tool registries
  getPrompts(): PromptEntry[];

  // inline prompts only
  getInlinePrompts(): PromptEntry[];
}


export interface LoggerRegistryInterface {
  getLoggers(): LoggerEntry[];

}


export type GlobalRegistryKind =
  | 'LoggerRegistry'
  | 'ScopeRegistry'

export type ScopedRegistryKind =
  | 'AppRegistry'
  | 'AuthRegistry'
  | 'FlowRegistry'

export type AppRegistryKind =
  | 'ProviderRegistry'
  | 'PluginRegistry'
  | 'AdapterRegistry'
  | 'ToolRegistry'
  | 'PromptRegistry'
  | 'ResourceRegistry'


export type RegistryKind = GlobalRegistryKind | ScopedRegistryKind | AppRegistryKind;

export type RegistryType = {
  LoggerRegistry: LoggerRegistryInterface;
  ScopeRegistry: ScopeRegistryInterface;
  FlowRegistry: FlowRegistryInterface;
  AppRegistry: AppRegistryInterface;
  AuthRegistry: AuthRegistryInterface,
  ProviderRegistry: ProviderRegistryInterface;
  PluginRegistry: PluginRegistryInterface;
  AdapterRegistry: AdapterRegistryInterface;
  ToolRegistry: ToolRegistryInterface;
  ResourceRegistry: ResourceRegistryInterface;
  PromptRegistry: PromptRegistryInterface;
}