// file: libs/sdk/src/agent/agent.scope.ts

import 'reflect-metadata';
import { ProviderScope, Token, Type } from '@frontmcp/di';
import {
  EntryOwnerRef,
  FlowInputOf,
  FlowName,
  FlowOutputOf,
  FlowType,
  FrontMcpLogger,
  ScopeEntry,
  AgentMetadata,
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import FlowRegistry from '../flows/flow.registry';
import ToolRegistry from '../tool/tool.registry';
import ResourceRegistry from '../resource/resource.registry';
import PromptRegistry from '../prompt/prompt.registry';
import HookRegistry from '../hooks/hook.registry';
import PluginRegistry from '../plugin/plugin.registry';
import AdapterRegistry from '../adapter/adapter.registry';
import AgentRegistry from './agent.registry';
import CallToolFlow from '../tool/flows/call-tool.flow';
import { Scope } from '../scope';
import { ToolInstance } from '../tool/tool.instance';
import { normalizeTool } from '../tool/tool.utils';
import { FlowExitedWithoutOutputError } from '../errors';

/**
 * AgentScope provides an isolated, private scope for agent execution.
 *
 * Each agent acts as a "private app" with its own registries that are not
 * exposed to the parent scope. This enables:
 *
 * 1. **Complete Isolation**: Agent's tools, plugins, adapters, providers,
 *    resources, prompts, and nested agents are private.
 *
 * 2. **Flow Integration**: Tool calls route through the standard `tools:call-tool`
 *    flow, enabling hooks, plugins, authorization, and other flow features.
 *
 * 3. **Plugin/Adapter Support**: Agent can define its own plugins and adapters
 *    for custom functionality.
 *
 * 4. **Parent Delegation**: For scope-level functionality (auth, notifications,
 *    toolUI), delegates to the parent scope.
 *
 * @example
 * ```typescript
 * // AgentScope is created internally by AgentInstance
 * const agentScope = new AgentScope(parentScope, agentId, agentMetadata);
 * await agentScope.ready;
 *
 * // Execute tool through flow
 * const result = await agentScope.runFlowForOutput('tools:call-tool', {
 *   request: { method: 'tools/call', params: { name: 'myTool', arguments: {} } },
 *   ctx: { authInfo },
 * });
 * ```
 */
export class AgentScope {
  readonly id: string;
  readonly entryPath: string;
  readonly routeBase: string;
  readonly fullPath: string;
  readonly logger: FrontMcpLogger;
  readonly ready: Promise<void>;

  private readonly parentScope: Scope;
  private readonly agentOwner: EntryOwnerRef;

  // Agent's own registries (like an app)
  private agentProviders!: ProviderRegistry;
  private agentPlugins!: PluginRegistry;
  private agentAdapters!: AdapterRegistry;
  private agentTools!: ToolRegistry;
  private agentResources!: ResourceRegistry;
  private agentPrompts!: PromptRegistry;
  private agentAgents!: AgentRegistry;
  private agentHooks!: HookRegistry;
  private agentFlows!: FlowRegistry;

  constructor(
    parentScope: Scope,
    agentId: string,
    private readonly metadata: AgentMetadata,
    agentToken: Token,
  ) {
    this.parentScope = parentScope;
    this.id = `agent:${agentId}`;
    this.entryPath = parentScope.entryPath;
    this.routeBase = parentScope.routeBase;
    this.fullPath = parentScope.fullPath;
    this.logger = parentScope.logger.child(`AgentScope(${agentId})`);

    this.agentOwner = {
      kind: 'agent',
      id: this.id,
      ref: agentToken,
    };

    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    // Create agent-specific providers that delegate to parent scope
    // Use a custom AgentScopeEntry class to provide to the scope
    const agentScopeEntry = new AgentScopeEntry(this);

    this.agentProviders = new ProviderRegistry(
      [
        // Provide the agent scope entry as ScopeEntry for flows
        {
          scope: ProviderScope.GLOBAL,
          name: 'ScopeEntry',
          provide: ScopeEntry,
          useValue: agentScopeEntry,
        },
        // Also register as Scope so getActiveScope() returns the agent's scope
        // instead of falling back to parent scope
        {
          scope: ProviderScope.GLOBAL,
          name: 'Scope',
          provide: Scope,
          useValue: agentScopeEntry,
        },
        {
          scope: ProviderScope.GLOBAL,
          name: 'AgentScope',
          provide: AgentScope,
          useValue: this,
        },
        {
          scope: ProviderScope.GLOBAL,
          name: 'FrontMcpLogger',
          provide: FrontMcpLogger,
          useValue: this.logger,
        },
        // Add any agent-specific providers from metadata
        ...(this.metadata.providers ?? []),
      ],
      this.parentScope.providers as ProviderRegistry,
    );

    await this.agentProviders.ready;

    // Initialize hooks registry (agent's own hooks only)
    this.agentHooks = new HookRegistry(this.agentProviders, []);
    await this.agentHooks.ready;

    // Initialize flow registry with call-tool flow
    this.agentFlows = new FlowRegistry(this.agentProviders, [CallToolFlow]);
    await this.agentFlows.ready;

    // Initialize plugins (they can register providers, tools, etc.)
    const pluginOwner = {
      kind: 'agent' as const,
      id: this.id,
      ref: this.agentOwner.ref,
    };
    this.agentPlugins = new PluginRegistry(this.agentProviders, this.metadata.plugins ?? [], pluginOwner);
    await this.agentPlugins.ready;

    // Initialize adapters
    this.agentAdapters = new AdapterRegistry(this.agentProviders, this.metadata.adapters ?? []);
    await this.agentAdapters.ready;

    // Initialize tool registry (empty initially, tools added separately)
    this.agentTools = new ToolRegistry(this.agentProviders, [], this.agentOwner);
    await this.agentTools.ready;

    // Initialize tools from metadata
    const toolTypes = this.metadata.tools ?? [];
    for (const toolType of toolTypes) {
      try {
        const record = normalizeTool(toolType);
        const toolInstance = new ToolInstance(record, this.agentProviders, this.agentOwner);
        await toolInstance.ready;
        this.agentTools.registerToolInstance(toolInstance);
      } catch (error) {
        this.logger.error(`Failed to initialize tool in agent scope ${this.id}`, error);
        throw error;
      }
    }

    // Initialize resources
    this.agentResources = new ResourceRegistry(this.agentProviders, this.metadata.resources ?? [], this.agentOwner);
    await this.agentResources.ready;

    // Initialize prompts
    this.agentPrompts = new PromptRegistry(this.agentProviders, this.metadata.prompts ?? [], this.agentOwner);
    await this.agentPrompts.ready;

    // Initialize nested agents
    this.agentAgents = new AgentRegistry(this.agentProviders, this.metadata.agents ?? [], this.agentOwner);
    await this.agentAgents.ready;

    this.logger.info(
      `AgentScope initialized with ${toolTypes.length} tool(s), ${this.metadata.plugins?.length ?? 0} plugin(s)`,
    );
  }

  // ============================================================================
  // Own Registries
  // ============================================================================

  get tools(): ToolRegistry {
    return this.agentTools;
  }

  get hooks(): HookRegistry {
    return this.agentHooks;
  }

  get providers(): ProviderRegistry {
    return this.agentProviders;
  }

  get plugins(): PluginRegistry {
    return this.agentPlugins;
  }

  get adapters(): AdapterRegistry {
    return this.agentAdapters;
  }

  get resources(): ResourceRegistry {
    return this.agentResources;
  }

  get prompts(): PromptRegistry {
    return this.agentPrompts;
  }

  get agents(): AgentRegistry {
    return this.agentAgents;
  }

  // ============================================================================
  // Delegated to Parent Scope
  // ============================================================================

  get auth() {
    return this.parentScope.auth;
  }

  get authProviders() {
    return this.parentScope.authProviders;
  }

  get apps() {
    return this.parentScope.apps;
  }

  get notifications() {
    return this.parentScope.notifications;
  }

  get toolUI() {
    return this.parentScope.toolUI;
  }

  // ============================================================================
  // Flow Execution
  // ============================================================================

  async registryFlows(...flows: FlowType[]): Promise<void> {
    await this.agentFlows.registryFlows(flows);
  }

  runFlow<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    deps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name> | undefined> {
    return this.agentFlows.runFlow(name, input, deps);
  }

  async runFlowForOutput<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    deps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name>> {
    const result = await this.agentFlows.runFlow(name, input, deps);
    if (result !== undefined) {
      return result;
    }
    throw new FlowExitedWithoutOutputError();
  }
}

/**
 * A minimal ScopeEntry-like wrapper for AgentScope.
 * This enables AgentScope to be used in places that expect a ScopeEntry,
 * such as flows that access `this.scope`.
 */
class AgentScopeEntry {
  readonly id: string;
  readonly entryPath: string;
  readonly routeBase: string;
  readonly fullPath: string;
  readonly logger: FrontMcpLogger;

  constructor(private readonly agentScope: AgentScope) {
    this.id = agentScope.id;
    this.entryPath = agentScope.entryPath;
    this.routeBase = agentScope.routeBase;
    this.fullPath = agentScope.fullPath;
    this.logger = agentScope.logger;
  }

  get auth() {
    return this.agentScope.auth;
  }

  get hooks() {
    return this.agentScope.hooks;
  }

  get authProviders() {
    return this.agentScope.authProviders;
  }

  get providers() {
    return this.agentScope.providers;
  }

  get apps() {
    return this.agentScope.apps;
  }

  get tools() {
    return this.agentScope.tools;
  }

  get resources() {
    return this.agentScope.resources;
  }

  get prompts() {
    return this.agentScope.prompts;
  }

  get agents() {
    return this.agentScope.agents;
  }

  get notifications() {
    return this.agentScope.notifications;
  }

  get toolUI() {
    return this.agentScope.toolUI;
  }

  registryFlows(...flows: FlowType[]): Promise<void> {
    return this.agentScope.registryFlows(...flows);
  }

  runFlow<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    deps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name> | undefined> {
    return this.agentScope.runFlow(name, input, deps);
  }
}
