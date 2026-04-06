import { Token } from '@frontmcp/di';
import { ScopeEntry, FlowEntry, ProviderEntry, PluginEntry, AdapterEntry, LoggerEntry } from '../../entries';
import { FlowName } from '../../metadata';

// Import concrete registry classes using `import type` to avoid circular deps
import type HookRegistryCls from '../../../hooks/hook.registry';
import type { AuthRegistry as AuthRegistryCls } from '../../../auth/auth.registry';
import type AppRegistryCls from '../../../app/app.registry';
import type ToolRegistryCls from '../../../tool/tool.registry';
import type ResourceRegistryCls from '../../../resource/resource.registry';
import type PromptRegistryCls from '../../../prompt/prompt.registry';
import type AgentRegistryCls from '../../../agent/agent.registry';

export interface ScopeRegistryInterface {
  getScopes(): ScopeEntry[];
}

export interface FlowRegistryInterface {
  getFlows(): FlowEntry<FlowName>[];
}

export interface ProviderViews {
  /** App-wide singletons, created at boot. Immutable from invoke's POV. */
  global: ReadonlyMap<Token, unknown>;

  /** Context-scoped providers for this invocation. Unified session+request data. */
  context: Map<Token, unknown>;
}

export interface ProviderRegistryInterface {
  get<T>(token: Token<T>): T;

  getScope(): ScopeEntry;

  getProviders(): ProviderEntry[];

  getRegistries<T extends RegistryKind>(type: T): RegistryType[T][];

  // TODO: fix session type
  buildViews(session: any): Promise<ProviderViews>;
}

export interface PluginRegistryInterface {
  getPlugins(): PluginEntry[];
  getPluginNames(): string[];
}

export interface AdapterRegistryInterface {
  getAdapters(): AdapterEntry[];
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
  | 'ResourceRegistry'
  | 'AgentRegistry'
  | 'SkillRegistry'
  | 'JobRegistry'
  | 'WorkflowRegistry'
  | 'ChannelRegistry';

export type RegistryKind = GlobalRegistryKind | ScopedRegistryKind | AppRegistryKind;

// Import SkillRegistryInterface - using type import to avoid circular dependency
import type { SkillRegistryInterface } from '../../../skill/skill.registry';
import type { JobRegistryInterface } from '../../../job/job.registry';
import type { WorkflowRegistryInterface } from '../../../workflow/workflow.registry';
import type { ChannelRegistryInterface } from '../../../channel/channel.registry';

export type RegistryType = {
  LoggerRegistry: LoggerRegistryInterface;
  ScopeRegistry: ScopeRegistryInterface;
  FlowRegistry: FlowRegistryInterface;
  HookRegistry: HookRegistryCls;
  AppRegistry: AppRegistryCls;
  AuthRegistry: AuthRegistryCls;
  ProviderRegistry: ProviderRegistryInterface;
  PluginRegistry: PluginRegistryInterface;
  AdapterRegistry: AdapterRegistryInterface;
  ToolRegistry: ToolRegistryCls;
  ResourceRegistry: ResourceRegistryCls;
  PromptRegistry: PromptRegistryCls;
  AgentRegistry: AgentRegistryCls;
  SkillRegistry: SkillRegistryInterface;
  JobRegistry: JobRegistryInterface;
  WorkflowRegistry: WorkflowRegistryInterface;
  ChannelRegistry: ChannelRegistryInterface;
};
