// file: libs/sdk/src/agent/agent.instance.ts

import { AuthorityDeniedError, type AuthoritiesMetadata } from '@frontmcp/auth';
import { type Token } from '@frontmcp/di';
import { toJSONSchema, z } from '@frontmcp/lazy-zod';
import { type CallToolRequest, type CallToolResult, type TextContent, type Tool } from '@frontmcp/protocol';

import { ConfigService } from '../builtin/config';
import {
  AgentContext,
  AgentEntry,
  AgentKind,
  type AgentCallArgs,
  type AgentCallExtra,
  type AgentCtorArgs,
  type AgentFunctionTokenRecord,
  type AgentInputOf,
  type AgentInvoker,
  type AgentLlmAdapter,
  type AgentOutputOf,
  type AgentRecord,
  type EntryOwnerRef,
  type ParsedAgentResult,
  type PromptEntry,
  type ResourceEntry,
  type SafeTransformResult,
  type ScopeEntry,
  type ToolCallExtra,
  type ToolEntry,
  type ToolInputType,
  type ToolMetadata,
  type ToolOutputType,
} from '../common';
import { isOfferedOnSurface, type CallSurface } from '../common/availability';
import { tool as toolDecorator } from '../common/decorators/tool.decorator';
import { runOnSurface } from '../context/call-surface';
import { runAsTool } from '../context/running-tool';
import {
  AgentConfigKeyNotFoundError,
  AgentConfigurationError,
  AgentNotConfiguredError,
  AgentNotFoundError,
  AgentToolExecutionError,
  AgentToolNotFoundError,
  AgentVisibilityError,
  InvalidHookFlowError,
  InvalidInputError,
} from '../errors';
import { describeUnreachableEntryClassHooks, unreachableHooksMessage } from '../hooks/entry-class-hooks';
import type HookRegistry from '../hooks/hook.registry';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { normalizePrompt } from '../prompt/prompt.utils';
import type ProviderRegistry from '../provider/provider.registry';
import { normalizeProvider } from '../provider/provider.utils';
import { isResourceTemplate, normalizeResource, normalizeResourceTemplate } from '../resource/resource.utils';
import { ToolInstance } from '../tool/tool.instance';
import { buildAgentToolDefinition, buildParsedToolResult, normalizeTool } from '../tool/tool.utils';
import { errorBehindFlowControl } from '../transport/mcp-handlers/mcp-error.utils';
import { createAdapter, type ConfigResolver, type CreateAdapterOptions } from './adapters';
import {
  AGENT_BUILTIN_TOOL_DEFINITIONS,
  offeredAgentBuiltinTools,
  runAgentBuiltinTool,
  type AgentBuiltinToolName,
} from './agent-builtin-tools';
import { type ToolExecutor } from './agent-execution-loop';
import { AgentScope } from './agent.scope';
import { agentToolName, canAgentSeeSwarm, getVisibleAgentIds, isAgentVisibleToSwarm } from './agent.utils';
import { agentClassHooksJoin } from './flows/call-agent.flow';

// ============================================================================
// Constants
// ============================================================================

/** Valid flow names for agent hooks */
const VALID_AGENT_HOOK_FLOWS = ['agents:call-agent', 'agents:list-agents'] as const;

/** The surface (`availableWhen.surface`) an agent's model calls its tools on. */
const AGENT_SURFACE: CallSurface = 'agent';

/**
 * Agent configuration that is not tool metadata, so it is never copied onto the agent's
 * `invoke_<agent>` tool. `execution` is the agent loop's configuration, not a tool's task support.
 * Any other field an agent declares is copied (see `buildAgentToolMetadata`).
 * @internal Exported for tests.
 */
export const AGENT_ONLY_METADATA_KEYS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'description',
  'systemInstructions',
  'inputSchema',
  'outputSchema',
  'llm',
  'providers',
  'plugins',
  'adapters',
  'agents',
  'tools',
  'resources',
  'prompts',
  'exports',
  'swarm',
  'execution',
  'tags',
  'hideFromDiscovery',
]);

/** A tool the agent's model is offered, under the name the model calls it by. */
type AgentModelTool =
  | {
      kind: 'tool';
      name: string;
      entry: ToolEntry;
      /**
       * Where a call runs: the agent's private scope (its own tools, through that scope's `tools:call-tool`
       * flow unless `execution.useToolFlow` is false), that scope's `tools:call-tool` flow whatever
       * `useToolFlow` says (its nested agents' `invoke_<agent>` tools), or the scope it is registered in.
       */
      via: 'agent-scope' | 'nested-agent' | 'parent-scope';
    }
  | {
      /** A tool that reads the agent's resources or prompts through its private scope's flows (#699). */
      kind: 'builtin';
      name: AgentBuiltinToolName;
      scope: AgentScope;
    };

// ============================================================================
// Agent Instance
// ============================================================================

/**
 * Concrete implementation of AgentEntry.
 *
 * AgentInstance manages an agent's lifecycle, including:
 * - LLM adapter initialization and configuration
 * - Agent-scoped tool registration (tools are private to this agent)
 * - Hook registration for agent-specific flows
 * - Input/output schema parsing and validation
 * - Tool definition generation for MCP exposure
 * - Swarm visibility configuration
 *
 * @template InSchema - Zod schema type for agent input
 * @template OutSchema - Zod schema type for agent output
 * @template In - Inferred input type from InSchema
 * @template Out - Inferred output type from OutSchema
 *
 * @example
 * ```typescript
 * // Created internally by AgentRegistry
 * const instance = new AgentInstance(record, providers, owner);
 * await instance.ready;
 *
 * // Create an execution context
 * const context = instance.create(input, { authInfo });
 * const result = await context.execute(input);
 * ```
 */
export class AgentInstance<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = AgentInputOf<{ inputSchema: InSchema }>,
  Out = AgentOutputOf<{ outputSchema: OutSchema }>,
> extends AgentEntry<InSchema, OutSchema, In, Out> {
  private readonly providerRegistry: ProviderRegistry;
  readonly scope: ScopeEntry;
  readonly hooks: HookRegistry;

  /** The LLM adapter for this agent */
  private llmAdapter: AgentLlmAdapter | null = null;

  /** Agent-scoped tools (from @Agent({ tools: [...] })) */
  private agentTools: ToolEntry[] = [];

  /** Agent's private scope (like a private app with its own registries) */
  private agentScope: AgentScope | null = null;

  /**
   * The agent exposed as a standard tool for registration in parent scope.
   * This allows the agent to be called like any other tool (invoke_<agent>) and
   * go through the standard tools:call-tool flow with all plugins/hooks.
   */
  private agentToolInstance: ToolInstance | null = null;

  /** The resources and prompts this agent exports to its parent scope (`exports`). */
  private exportedResources: ResourceEntry[] = [];
  private exportedPrompts: PromptEntry[] = [];

  constructor(record: AgentRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providerRegistry = providers;
    this.name = record.metadata.id ?? record.metadata.name;
    this.id = record.metadata.id ?? record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this.providerRegistry.getActiveScope();
    this.hooks = this.scope.hooks;

    // inputSchema is always a ZodRawShape
    this.inputSchema = (record.metadata.inputSchema ?? {}) as InSchema;

    // Keep raw output schema
    this.outputSchema = record.metadata.outputSchema as OutSchema;

    // System instructions
    this.systemInstructions = record.metadata.systemInstructions;

    this.ready = this.initialize();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  protected async initialize(): Promise<void> {
    // Initialize agent-scoped tools from metadata
    await this.initializeAgentTools();

    // Its own tools must leave the names of the tools that read its resources and prompts free
    this.assertNoBuiltinToolClash();

    // Create LLM adapter from configuration
    await this.initializeLlmAdapter();

    // Register hooks from the agent class
    await this.registerHooks();

    // Create the agent as a standard tool for parent scope registration
    await this.createAgentAsTool();

    // Say so at startup when the agent declares something nothing acts on
    this.warnAboutUnusedOptions();
  }

  /**
   * Options the agent accepts that have no effect yet, logged at startup instead of being dropped
   * silently: `execution.enableStreaming`.
   */
  private warnAboutUnusedOptions(): void {
    if (this.record.metadata.execution?.enableStreaming === true) {
      this.scope.logger.warn(
        `Agent "${this.name}": execution.enableStreaming is not supported yet and has no effect; ` +
          `the agent replies once its run completes. Use enableAutoProgress for progress notifications during the run.`,
      );
    }
  }

  /**
   * Fail startup when one of the agent's own tools (its `tools`, a plugin's or adapter's tool, a nested
   * agent's `invoke_<agent>` tool) takes the name of a built-in tool its model is offered to read its
   * resources and prompts (`list_resources`, `read_resource`, `list_prompts`, `get_prompt`): the model
   * could not tell them apart.
   */
  private assertNoBuiltinToolClash(): void {
    if (!this.agentScope) return;
    const builtins = new Set<string>(offeredAgentBuiltinTools(this.agentScope));
    const clash = this.agentTools.find((tool) => builtins.has(tool.metadata.id ?? tool.metadata.name));
    if (!clash) return;
    throw new AgentConfigurationError(
      `Agent "${this.name}" has a tool named "${clash.metadata.id ?? clash.metadata.name}", the name of a ` +
        `built-in tool its model reads the agent's resources and prompts with. Rename the tool.`,
      { agentId: this.id },
    );
  }

  /**
   * Initialize the agent's private scope.
   *
   * The AgentScope acts as a "private app" with its own registries for:
   * - Tools (from @Agent({ tools: [...] }))
   * - Plugins (from @Agent({ plugins: [...] }))
   * - Adapters (from @Agent({ adapters: [...] }))
   * - Providers (from @Agent({ providers: [...] }))
   * - Resources, Prompts, nested Agents
   *
   * This scope is isolated from the parent scope and not exposed externally.
   * Tool calls are routed through the scope's call-tool flow for full lifecycle support.
   */
  private async initializeAgentTools(): Promise<void> {
    const metadata = this.record.metadata;

    // Check if the agent has any components that require a scope
    const hasTools = (metadata.tools?.length ?? 0) > 0;
    const hasPlugins = (metadata.plugins?.length ?? 0) > 0;
    const hasAdapters = (metadata.adapters?.length ?? 0) > 0;
    const hasProviders = (metadata.providers?.length ?? 0) > 0;
    const hasResources = (metadata.resources?.length ?? 0) > 0;
    const hasPrompts = (metadata.prompts?.length ?? 0) > 0;
    const hasAgents = (metadata.agents?.length ?? 0) > 0;

    // Only create AgentScope if the agent has any scoped components
    if (!hasTools && !hasPlugins && !hasAdapters && !hasProviders && !hasResources && !hasPrompts && !hasAgents) {
      // With nothing of its own, everything it exports is something it doesn't declare
      this.resolveExports(undefined);
      return;
    }

    // Create the agent's private scope
    this.agentScope = new AgentScope(this.scope, this.id, metadata, this.record.provide, {
      ownerId: this.owner.id,
      providers: this.providerRegistry,
    });

    await this.agentScope.ready;

    // Get tool instances from the agent scope for tool definitions (its own tools, and its nested
    // agents' `invoke_<agent>` tools)
    this.agentTools = this.agentScope.tools.getTools(true);

    // What it exports to its parent scope (`exports`)
    this.resolveExports(this.agentScope);

    this.scope.logger.info(
      `Agent ${this.name} initialized with AgentScope: ${this.agentTools.length} tool(s), ${
        metadata.plugins?.length ?? 0
      } plugin(s)`,
    );
  }

  /**
   * Resolve `exports`: the providers are added to the registry this agent was registered with (its
   * app's, or its parent agent's), so the entries there can inject them; the resources and prompts
   * are kept for the parent scope's registries (see {@link getExportedResources}). Fails when an
   * export is not one of the agent's own resources, prompts or providers.
   */
  private resolveExports(agentScope: AgentScope | undefined): void {
    const exportsConfig = this.record.metadata.exports;
    if (!exportsConfig) return;

    const resources = agentScope?.resources.getInlineResources() ?? [];
    if (exportsConfig.resources === '*') {
      this.exportedResources = resources;
    } else if (exportsConfig.resources) {
      this.exportedResources = exportsConfig.resources.map((item) => {
        const token = (isResourceTemplate(item) ? normalizeResourceTemplate(item) : normalizeResource(item)).provide;
        const entry = resources.find((resource) => resource.record.provide === token);
        if (!entry) throw this.undeclaredExportError('resources', token);
        return entry;
      });
    }

    const prompts = agentScope?.prompts.getInlinePrompts() ?? [];
    if (exportsConfig.prompts === '*') {
      this.exportedPrompts = prompts;
    } else if (exportsConfig.prompts) {
      this.exportedPrompts = exportsConfig.prompts.map((item) => {
        const token = normalizePrompt(item).provide;
        const entry = prompts.find((prompt) => prompt.record.provide === token);
        if (!entry) throw this.undeclaredExportError('prompts', token);
        return entry;
      });
    }

    if (exportsConfig.providers && exportsConfig.providers.length > 0) {
      const declared = new Set((this.record.metadata.providers ?? []).map((item) => normalizeProvider(item).provide));
      const tokens = exportsConfig.providers.map((item) => {
        const token = normalizeProvider(item).provide;
        if (!declared.has(token) || !agentScope) throw this.undeclaredExportError('providers', token);
        return token;
      });
      if (agentScope) {
        const exported = tokens.map((token) => agentScope.providers.getProviderInfo(token));
        this.providerRegistry.mergeFromRegistry(agentScope.providers, exported);
      }
    }
  }

  private undeclaredExportError(kind: 'resources' | 'prompts' | 'providers', token: unknown): AgentConfigurationError {
    const label =
      typeof token === 'function'
        ? token.name || '(anonymous)'
        : typeof token === 'symbol'
          ? (token.description ?? token.toString())
          : String(token);
    return new AgentConfigurationError(
      `Agent "${this.name}" exports ${kind} "${label}", which is not one of its own ${kind} (\`${kind}: [...]\`)`,
      { agentId: this.id },
    );
  }

  /** The resources this agent exports to its parent scope (`exports.resources`). */
  getExportedResources(): readonly ResourceEntry[] {
    return this.exportedResources;
  }

  /** The prompts this agent exports to its parent scope (`exports.prompts`). */
  getExportedPrompts(): readonly PromptEntry[] {
    return this.exportedPrompts;
  }

  /**
   * Initialize the LLM adapter from the agent's metadata configuration.
   */
  private async initializeLlmAdapter(): Promise<void> {
    const llmConfig = this.record.metadata.llm;

    if (!llmConfig) {
      // No LLM configured - this agent may use a custom implementation
      return;
    }

    // Build adapter options with provider resolver
    const adapterOptions: CreateAdapterOptions = {
      providerResolver: {
        get: <T>(token: Token<T>): T => {
          return this.providerRegistry.get(token);
        },
        tryGet: <T>(token: Token<T>) => {
          try {
            return this.providerRegistry.get(token);
          } catch {
            return undefined;
          }
        },
      },
      // Entity context for auto-fallback config resolution
      entityContext: {
        entityType: 'agents',
        entityName: this.name,
      },
    };

    // Try to get ConfigService for config resolution
    try {
      const configService = this.providerRegistry.get(ConfigService);
      if (configService) {
        adapterOptions.configResolver = this.createConfigResolver(configService);
      }
    } catch {
      // ConfigPlugin not installed - config resolution via withConfig will not be available
      this.scope.logger.debug(`ConfigService not available for agent ${this.name} - withConfig resolution disabled`);
    }

    try {
      this.llmAdapter = createAdapter(llmConfig, adapterOptions);
    } catch (error) {
      this.scope.logger.error(`Failed to create LLM adapter for agent ${this.name}`, error);
      throw error;
    }
  }

  /**
   * Create a ConfigResolver from the ConfigService.
   * Uses getAll() and manual path traversal to avoid DottedPath type complexity.
   */

  private createConfigResolver(configService: ConfigService<any>): ConfigResolver {
    // Get the raw config object to avoid DottedPath type complexity
    const config = configService.getAll();

    const getNestedValue = (path: string): unknown => {
      const keys = path.split('.');
      let current: unknown = config;
      for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
          current = (current as Record<string, unknown>)[key];
        } else {
          return undefined;
        }
      }
      return current;
    };

    return {
      get<T>(path: string): T {
        const value = getNestedValue(path);
        if (value === undefined) {
          throw new AgentConfigKeyNotFoundError(path);
        }
        return value as T;
      },
      tryGet<T>(path: string): T | undefined {
        return getNestedValue(path) as T | undefined;
      },
    };
  }

  /**
   * Register hooks from the agent class.
   * Validates that hooks are only registered for agent-specific flows.
   *
   * @throws InvalidHookFlowError If hooks are registered for non-agent flows
   */
  private async registerHooks(): Promise<void> {
    const allHooks = normalizeHooksFromCls(this.record.provide);

    // Separate valid and invalid hooks using the module-level constant
    const validHooks = allHooks.filter((hook) =>
      (VALID_AGENT_HOOK_FLOWS as readonly string[]).includes(hook.metadata.flow),
    );
    const invalidHooks = allHooks.filter(
      (hook) => !(VALID_AGENT_HOOK_FLOWS as readonly string[]).includes(hook.metadata.flow),
    );

    // Throw error for invalid hooks (fail fast)
    if (invalidHooks.length > 0) {
      const className = this.getClassName();
      const invalidFlowNames = invalidHooks.map((h) => h.metadata.flow).join(', ');
      throw new InvalidHookFlowError(
        `Agent "${className}" has hooks for unsupported flows: ${invalidFlowNames}. ` +
          `Only agent flows (${VALID_AGENT_HOOK_FLOWS.join(', ')}) are supported on agent classes.`,
      );
    }

    // Fail fast on hooks that would never run on this class (#678)
    const unreachable = describeUnreachableEntryClassHooks(validHooks, agentClassHooksJoin, ['agents:list-agents']);
    if (unreachable.length > 0) {
      throw new InvalidHookFlowError(unreachableHooksMessage('Agent', this.getClassName(), unreachable));
    }

    // Register valid hooks
    if (validHooks.length > 0) {
      await this.hooks.registerHooks(true, ...validHooks);
    }
  }

  /**
   * Get the class name from the record's provide property.
   * Used for error messages and logging.
   */
  private getClassName(): string {
    const provide = this.record.provide;
    if (typeof provide === 'function' && 'name' in provide) {
      return (provide as { name: string }).name;
    }
    return 'Unknown';
  }

  // ============================================================================
  // Agent as Tool
  // ============================================================================

  /**
   * Create the agent as a standard ToolInstance for registration in parent scope.
   *
   * This follows the same pattern as OpenAPI adapters that create dynamic tools
   * with a prebuilt execute function. The agent's execute handler internally calls
   * the agent's LLM execution loop.
   *
   * Benefits:
   * - Agent tools go through standard tools:call-tool flow
   * - Plugin metadata extensions (cache, codecall) work on agents
   * - CodeCall can discover and search for agent tools
   * - Unified hook/plugin execution
   */
  private async createAgentAsTool(): Promise<void> {
    // Skip if no LLM adapter (agent may use custom implementation or failed to initialize)
    if (!this.llmAdapter) {
      this.scope.logger.debug(
        `Agent ${this.name} has no LLM adapter configured - skipping tool registration. ` +
          `Agent will not be callable as a tool via invoke_${this.id}.`,
      );
      return;
    }

    try {
      // Build tool metadata from agent metadata
      const toolMetadata = this.buildAgentToolMetadata();

      // Create the tool using the tool() decorator pattern
      const agentToolFunction = toolDecorator(toolMetadata)(this.createAgentToolExecuteHandler());

      // Normalize to ToolRecord
      const toolRecord = normalizeTool(agentToolFunction);

      // Create ToolInstance with parent scope's providers
      this.agentToolInstance = new ToolInstance(toolRecord, this.providerRegistry, this.owner);
      await this.agentToolInstance.ready;

      this.scope.logger.debug(`Created agent tool instance: ${this.agentToolInstance.name} for agent ${this.name}`);
    } catch (error) {
      this.scope.logger.error(`Failed to create agent tool instance for ${this.name}`, error);
      throw error;
    }
  }

  /**
   * Build ToolMetadata from AgentMetadata.
   *
   * The agent is listed and called only through this tool, so everything the agent declares
   * that gates a tool (availability, limits, and every plugin extension such as `authorities`,
   * `approval` or `featureFlag`) is copied onto it.
   */
  private buildAgentToolMetadata(): ToolMetadata {
    const agentMeta = this.record.metadata;

    // Build the base tool metadata
    const toolMeta: ToolMetadata = {
      id: agentToolName(this.id),
      name: agentToolName(this.id),
      description: this.buildToolDescription(agentMeta),
      inputSchema: this.inputSchema ?? {},
      outputSchema: agentMeta.outputSchema,
      tags: [...(agentMeta.tags ?? []), 'agent'],
      annotations: {
        title: agentMeta.name,
        readOnlyHint: false,
        openWorldHint: true,
      },
      hideFromDiscovery: agentMeta.hideFromDiscovery,
    };

    // Copy everything else the agent declares. The tools:list-tools and tools:call-tool flows, and
    // the plugins hooked into them, only read this tool's metadata, so a field left behind gates
    // nothing: `availableWhen`, `rateLimit`, `concurrency`, `timeout`, and every plugin extension
    // (AgentMetadata extends ExtendFrontMcpToolMetadata: `authorities`, `approval`, `featureFlag`,
    // `cache`, `codecall`, and whatever a plugin adds later).
    //
    // Note: Double-cast through 'unknown' is required because TypeScript's control flow
    // analysis cannot track properties added via global interface augmentation
    // (ExtendFrontMcpToolMetadata). Plugin modules declare their extension keys in global
    // scope (e.g., 'cache', 'codecall'), which TypeScript doesn't recognize on concrete types.
    const extendedMeta = agentMeta as unknown as Record<string, unknown>;
    const mutableToolMeta = toolMeta as unknown as Record<string, unknown>;

    for (const [key, value] of Object.entries(extendedMeta)) {
      if (value === undefined || AGENT_ONLY_METADATA_KEYS.has(key) || key in mutableToolMeta) continue;
      mutableToolMeta[key] = value;
    }

    return toolMeta;
  }

  /**
   * Create the execute handler for the agent tool.
   *
   * The tool's `tools:call-tool` flow has already applied everything the agent declares
   * (authorities, rate limit, concurrency, timeout and plugin gates, copied onto the tool). The
   * handler then runs the agent through the `agents:call-agent` flow, so the hooks registered for
   * agent invocation (`AgentCallHook`, and the agent class's own hooks on that flow) run and the
   * agent's context gets the request's context providers. The flow's own gates are left to the
   * tool flow (`gatedBy`), so nothing is counted twice.
   */
  private createAgentToolExecuteHandler(): (
    input: Record<string, unknown>,
    ctx: import('../common').ToolContext,
  ) => Promise<unknown> {
    return async (input, toolCtx) => {
      // Cast is safe because by the time we reach execute, auth has been validated in the flow
      const authInfo = toolCtx.authInfo as import('@frontmcp/protocol').AuthInfo;

      // The agent answers the same tools/call request: its JSON-RPC id routes an elicitation through
      // that request's stream, and its progress token tags the agent's progress notifications.
      const progressToken = toolCtx._progressTokenInternal;
      const requestId = toolCtx._jsonRpcRequestIdInternal;

      // A CallToolResult, which the tool flow passes through as it is.
      return this.scope.runFlowForOutput('agents:call-agent', {
        request: {
          method: 'tools/call',
          params: {
            name: this.id,
            arguments: input,
            ...(progressToken !== undefined ? { _meta: { progressToken } } : {}),
          },
        },
        ctx: {
          authInfo,
          ...(requestId !== undefined ? { requestId } : {}),
          ...(toolCtx.signal ? { signal: toolCtx.signal } : {}),
        },
        gatedBy: 'tools:call-tool',
      });
    };
  }

  /**
   * Get the ToolInstance representing this agent.
   *
   * This is used by AgentRegistry to register the agent tool in the parent
   * scope's ToolRegistry, enabling standard tool flow with plugins/hooks.
   *
   * @returns The agent's ToolInstance, or null if not created
   */
  getToolInstance(): ToolInstance | null {
    return this.agentToolInstance;
  }

  /** The provider registry this agent was registered with (its app's). */
  get providers(): ProviderRegistry {
    return this.providerRegistry;
  }

  /**
   * The tools this agent can call: those it declares and those its plugins contribute, as its private
   * scope holds them. Empty until the agent is initialized.
   */
  getAgentTools(): readonly ToolEntry[] {
    return this.agentTools;
  }

  /**
   * Whether a tool this agent runs in its private scope (one of its own, or a nested agent's
   * `invoke_<agent>` tool) declares `rateLimit` or `concurrency`, at any depth of nested agents. The
   * server guards those calls with its guard manager, which it creates for such a limit even without
   * `throttle.enabled`.
   */
  declaresScopedLimits(): boolean {
    if (!this.agentScope) return false;
    const declaresLimit = (tool: ToolEntry) => Boolean(tool.metadata.rateLimit || tool.metadata.concurrency);
    return (
      this.agentScope.tools.getTools(true).some(declaresLimit) ||
      this.agentScope.agents.listAllInstances().some((agent) => agent.declaresScopedLimits())
    );
  }

  // ============================================================================
  // Entry Methods
  // ============================================================================

  getMetadata() {
    return this.record.metadata;
  }

  override getOutputSchema() {
    return this.outputSchema;
  }

  /**
   * Get the LLM adapter for this agent.
   */
  getLlmAdapter(): AgentLlmAdapter | null {
    return this.llmAdapter;
  }

  // ============================================================================
  // Abstract Method Implementations
  // ============================================================================

  /**
   * Create an AgentContext instance for executing this agent.
   *
   * @param input - The input arguments for the agent
   * @param ctx - Extra context including authInfo
   * @returns A new AgentContext instance ready for execution
   * @throws AgentNotConfiguredError If no LLM adapter is configured
   */
  override create(input: AgentCallArgs, ctx: AgentCallExtra): AgentContext<InSchema, OutSchema, In, Out> {
    if (!this.llmAdapter) {
      throw new AgentNotConfiguredError(this.name);
    }

    // Pass llmAdapter explicitly after the null check to avoid non-null assertion
    const agentCtorArgs = this.buildAgentCtorArgs(input, ctx, this.llmAdapter);

    switch (this.record.kind) {
      case AgentKind.CLASS_TOKEN:
        return new this.record.provide(agentCtorArgs) as AgentContext<InSchema, OutSchema, In, Out>;

      case AgentKind.FUNCTION:
        return new FunctionAgentContext<InSchema, OutSchema, In, Out>(
          this.record as AgentFunctionTokenRecord,
          agentCtorArgs,
        );

      case AgentKind.VALUE:
        return this.record.useValue as AgentContext<InSchema, OutSchema, In, Out>;

      case AgentKind.FACTORY:
        return this.record.useFactory(this.providerRegistry) as AgentContext<InSchema, OutSchema, In, Out>;

      case AgentKind.ESM:
        throw new AgentNotConfiguredError(`ESM agent "${this.name}" cannot be created via AgentInstance.create()`);

      case AgentKind.REMOTE:
        throw new AgentNotConfiguredError(`Remote agent "${this.name}" cannot be created via AgentInstance.create()`);

      default: {
        const _exhaustive: never = this.record;
        throw new Error(`Unknown agent kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }
  }

  /**
   * Build the constructor arguments for creating an AgentContext.
   *
   * @param input - The input arguments for the agent
   * @param ctx - Extra context including authInfo
   * @param llmAdapter - The LLM adapter (passed explicitly to avoid non-null assertion)
   */
  private buildAgentCtorArgs(
    input: AgentCallArgs,
    ctx: AgentCallExtra,
    llmAdapter: AgentLlmAdapter,
  ): AgentCtorArgs<In> {
    const scope = this.providerRegistry.getActiveScope();
    // The tools the model is offered for this run, and how each is called
    const modelTools = this.getModelTools();

    return {
      metadata: this.metadata,
      input: input as In,
      // The request's context-aware providers when the agents:call-agent flow built them, so
      // `this.context` and CONTEXT-scoped providers resolve inside the agent.
      providers: ctx.contextProviders ?? this.providerRegistry,
      logger: scope.logger,
      authInfo: ctx.authInfo,
      llmAdapter,
      toolDefinitions: modelTools.map((tool) =>
        tool.kind === 'builtin' ? AGENT_BUILTIN_TOOL_DEFINITIONS[tool.name] : buildAgentToolDefinition(tool.entry),
      ),
      toolExecutor: this.createToolExecutor(ctx, modelTools),
      agentInvoker: this.createAgentInvoker(ctx),
      ...(this.agentScope && { privateScope: this.agentScope }),
      progressToken: ctx.progressToken,
    };
  }

  /**
   * The tools this agent's model is offered, each under the name the model calls it by:
   * 1. when the agent declares resources, `list_resources` and `read_resource`, and when it declares
   *    prompts, `list_prompts` and `get_prompt`: they run through its private scope's resource and prompt
   *    flows (see {@link runAgentBuiltinTool});
   * 2. the agent's own tools (`tools`, and its nested agents' `invoke_<agent>` tools), run in its private scope
   *    (a nested agent always through that scope's `tools:call-tool` flow, see {@link createToolExecutor});
   * 3. with `swarm.canSeeOtherAgents`, the `invoke_<agent>` tools of the other agents of its scope that it
   *    sees (`swarm.visibleAgents`, and each one's `swarm.isVisible`), run through that scope;
   * 4. with `execution.inheritParentTools`, the tools of the scope it is registered in, other than agents,
   *    run through that scope.
   * A name already taken by an earlier tool is not offered again (an own tool by a built-in's name fails
   * startup instead, see {@link assertNoBuiltinToolClash}). Only tools whose `availableWhen.surface`
   * offers them to agents are included.
   */
  private getModelTools(): AgentModelTool[] {
    const tools: AgentModelTool[] = [];
    const names = new Set<string>();
    if (this.agentScope) {
      for (const name of offeredAgentBuiltinTools(this.agentScope)) {
        names.add(name);
        tools.push({ kind: 'builtin', name, scope: this.agentScope });
      }
    }
    const add = (entry: ToolEntry, via: 'agent-scope' | 'nested-agent' | 'parent-scope') => {
      const name = entry.metadata.id ?? entry.metadata.name;
      if (names.has(name) || !isOfferedOnSurface(entry.metadata.availableWhen, AGENT_SURFACE)) return;
      names.add(name);
      tools.push({ kind: 'tool', name, entry, via });
    };

    const nestedAgentTools = this.getNestedAgentTools();
    for (const tool of this.agentTools) add(tool, nestedAgentTools.has(tool) ? 'nested-agent' : 'agent-scope');
    for (const agent of this.getSwarmAgents()) {
      const tool = agent.getToolInstance();
      if (tool) add(tool, 'parent-scope');
    }
    for (const tool of this.getInheritedTools()) add(tool, 'parent-scope');
    return tools;
  }

  /** The `invoke_<agent>` tools of this agent's nested agents (`agents`), which its private scope holds. */
  private getNestedAgentTools(): Set<ToolEntry> {
    const tools = new Set<ToolEntry>();
    for (const agent of this.agentScope?.agents.listAllInstances() ?? []) {
      const tool = agent.getToolInstance();
      if (tool) tools.add(tool);
    }
    return tools;
  }

  /** The agents of the scope this agent is registered in that it may call (`swarm`). */
  private getSwarmAgents(): AgentInstance[] {
    if (!this.canSeeSwarm()) return [];
    return this.scope.agents?.getVisibleAgentsFor(this.id) ?? [];
  }

  /** With `execution.inheritParentTools`, the tools of the scope this agent is registered in, other than agents. */
  private getInheritedTools(): ToolEntry[] {
    if (this.record.metadata.execution?.inheritParentTools !== true) return [];
    const agentTools = new Set<ToolEntry>();
    for (const agent of this.scope.agents?.listAllInstances() ?? []) {
      const tool = agent.getToolInstance();
      if (tool) agentTools.add(tool);
    }
    return (this.scope.tools?.getTools() ?? []).filter((tool) => !agentTools.has(tool));
  }

  /**
   * Create the executor of the model's tool calls.
   *
   * The agent's own tools: when `execution.useToolFlow` is enabled (default: true), tool calls are
   * routed through the agent's private scope's call-tool flow. This enables full lifecycle
   * support including:
   * - Plugin integration (cache, PII, rate limiting, etc.)
   * - Hook execution (will/did/around stages)
   * - Authorization checks
   * - UI rendering
   * - MCP-compliant error handling
   *
   * When `execution.useToolFlow` is false, the agent's own tools are executed directly for
   * performance-critical scenarios. Its nested agents' `invoke_<agent>` tools still run through its
   * private scope's call-tool flow: that flow applies the gates a nested agent declares (authorities,
   * rate limit, concurrency, plugin gates), which the nested agent's `agents:call-agent` flow leaves to
   * it. Tools of the parent scope (swarm agents, inherited tools) always run through the parent
   * scope's call-tool flow, which applies what they declare. The built-in tools that read the agent's
   * resources and prompts always run through its private scope's resource and prompt flows.
   *
   * @param ctx - Extra context including authInfo
   * @param modelTools - The tools the model is offered for this run
   * @returns A function that executes tools by name
   */
  private createToolExecutor(ctx: AgentCallExtra, modelTools: readonly AgentModelTool[]): ToolExecutor {
    const useToolFlow = this.record.metadata.execution?.useToolFlow !== false;

    return async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
      // A tool the model isn't offered (one whose `surface` leaves out agents, say) answers the model
      // as a tool the agent doesn't have.
      const offered = modelTools.find(
        (t) =>
          t.name === toolName || (t.kind === 'tool' && (t.entry.name === toolName || t.entry.fullName === toolName)),
      );

      if (!offered) {
        throw new AgentToolNotFoundError(
          this.name,
          toolName,
          modelTools.map((t) => t.name),
        );
      }

      if (offered.kind === 'builtin') {
        return runAgentBuiltinTool(offered.scope, offered.name, args, { authInfo: ctx.authInfo });
      }

      const tool = offered.entry;
      if (offered.via === 'parent-scope') {
        return this.callToolThrough(this.scope, tool, args, ctx);
      }

      // The agent's private scope's flow: for a nested agent always, for its own tools unless useToolFlow is off
      if (this.agentScope && (useToolFlow || offered.via === 'nested-agent')) {
        return this.callToolThrough(this.agentScope, tool, args, ctx);
      }

      // Direct execution - faster but bypasses plugins/hooks, never the tool's `authorities`
      await this.assertToolAuthorized(tool, ctx.authInfo, args);
      const runningTool = { name: tool.name, fullName: tool.fullName };
      // The tool's code sees the agent's surface as `getCallSurface()`, as it would through the flow.
      return runOnSurface(AGENT_SURFACE, async () => {
        // The agent's context providers are the agent's, not the tool's: the tool builds its own.
        const { contextProviders: _agentProviders, ...toolCtx } = ctx;
        const toolContext = runAsTool(runningTool, () => tool.create(args, toolCtx as ToolCallExtra));
        try {
          return await runAsTool(runningTool, () => Promise.resolve(toolContext.execute(args)));
        } catch (error) {
          throw errorBehindFlowControl(error);
        }
      });
    };
  }

  /**
   * Call `tool` through `scope`'s `tools:call-tool` flow on the agent surface, and return what it
   * produced (see {@link extractToolResult}).
   */
  private async callToolThrough(
    scope: Pick<ScopeEntry, 'runFlowForOutput'>,
    tool: ToolEntry,
    args: Record<string, unknown>,
    ctx: AgentCallExtra,
  ): Promise<unknown> {
    const result = await scope
      .runFlowForOutput('tools:call-tool', {
        request: {
          method: 'tools/call',
          params: { name: tool.fullName, arguments: args },
        },
        ctx: {
          authInfo: ctx.authInfo,
          _skipUI: true, // Skip UI rendering - agent returns structured data
          surface: AGENT_SURFACE,
          ...(this.isAgentPrivateScope(scope) && { agentPrivateCall: true }),
        },
      })
      .catch((error: unknown) => {
        // A tool that called `this.fail(error)` fails the flow with that error, which the model reads
        throw errorBehindFlowControl(error);
      });

    // Extract the actual result from MCP CallToolResult format
    return this.extractToolResult(result);
  }

  /** This agent's private scope, or that of the agent it is nested in: the consent screen offers neither. */
  private isAgentPrivateScope(scope: Pick<ScopeEntry, 'runFlowForOutput'>): boolean {
    return scope === this.agentScope || (scope === this.scope && this.owner.kind === 'agent');
  }

  /**
   * Create the agent's `invokeAgent(agentId, input)`: it calls one of the agent's nested agents
   * (`agents`), or an agent of its scope the agent sees (`swarm`), through that agent's
   * `invoke_<agent>` tool, and returns the agent's output. The agent called must be one the model
   * could call too.
   */
  private createAgentInvoker(ctx: AgentCallExtra): AgentInvoker {
    return async (agentId: string, input: unknown): Promise<unknown> => {
      if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
        throw new InvalidInputError(`invokeAgent("${agentId}"): the input must be an object of the agent's arguments`);
      }
      const args = (input ?? {}) as Record<string, unknown>;
      const matches = (agent: AgentInstance) => agent.id === agentId || agent.name === agentId;

      const nested = this.agentScope?.agents.listAllInstances().find(matches);
      const nestedTool = nested?.getToolInstance();
      if (this.agentScope && nestedTool) {
        return this.callToolThrough(this.agentScope, nestedTool, args, ctx);
      }

      const visibleTool = this.getSwarmAgents().find(matches)?.getToolInstance();
      if (visibleTool) {
        return this.callToolThrough(this.scope, visibleTool, args, ctx);
      }

      if (this.scope.agents?.listAllInstances().some(matches)) {
        throw new AgentVisibilityError(this.id, agentId);
      }
      throw new AgentNotFoundError(agentId);
    };
  }

  /**
   * The `checkEntryAuthorities` stage of tools:call-tool, for a tool this agent runs directly
   * (`execution.useToolFlow: false`): the caller the agent runs for must satisfy the tool's `authorities`.
   */
  private async assertToolAuthorized(
    tool: ToolEntry,
    authInfo: AgentCallExtra['authInfo'] | undefined,
    args: Record<string, unknown>,
  ): Promise<void> {
    const authorities = (tool.metadata as unknown as Record<string, unknown>)['authorities'] as
      | AuthoritiesMetadata
      | undefined;
    if (!authorities) return;

    const entryName = tool.fullName || tool.name;
    const engine = this.scope.authoritiesEngine;
    const ctxBuilder = this.scope.authoritiesContextBuilder;
    // Unreachable once the server has started (it refuses to start this way); fail closed regardless.
    if (!engine || !ctxBuilder) {
      throw new AuthorityDeniedError({ entryType: 'Tool', entryName, deniedBy: 'authorities are not configured' });
    }

    const result = await engine.evaluate(
      authorities,
      ctxBuilder.build((authInfo ?? {}) as Record<string, unknown>, args),
    );
    if (!result.granted) {
      throw new AuthorityDeniedError({
        entryType: 'Tool',
        entryName,
        deniedBy: result.deniedBy ?? 'policy denied',
        denial: result.denial,
      });
    }
  }

  /**
   * Extract the actual result from MCP CallToolResult format.
   *
   * The call-tool flow returns a CallToolResult with:
   * - structuredContent: The raw tool output (preferred)
   * - content: Array of text/image content (fallback)
   * - isError: Whether the tool execution failed
   *
   * @param mcpResult - The CallToolResult from the flow
   * @returns The extracted tool result
   * @throws Error if the tool execution failed
   */
  private extractToolResult(mcpResult: CallToolResult | undefined): unknown {
    if (!mcpResult) return undefined;

    // Check for error result
    if (mcpResult.isError) {
      const errorContent = mcpResult.content?.[0];
      if (errorContent?.type === 'text') {
        throw new AgentToolExecutionError((errorContent as TextContent).text);
      }
      throw new AgentToolExecutionError('Tool execution failed');
    }

    // Prefer structuredContent (contains raw tool output)
    if (mcpResult.structuredContent !== undefined) {
      return mcpResult.structuredContent;
    }

    // Fall back to parsing text content
    const content = mcpResult.content;
    if (!content || content.length === 0) return undefined;

    // Single text content - try to parse as JSON
    if (content.length === 1 && content[0].type === 'text') {
      const text = (content[0] as TextContent).text;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    // Multiple content items - return as-is
    return content;
  }

  override parseInput(input: CallToolRequest['params']): AgentCallArgs {
    const inputSchema = z.object(this.inputSchema ?? {});
    return inputSchema.parse(input.arguments);
  }

  override parseOutput(raw: Out | Partial<Out> | unknown): ParsedAgentResult {
    const descriptor = this.outputSchema as unknown;
    return buildParsedToolResult(descriptor, raw);
  }

  override safeParseOutput(raw: Out | Partial<Out> | unknown): SafeTransformResult<ParsedAgentResult> {
    try {
      return { success: true, data: this.parseOutput(raw) };
    } catch (error: unknown) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Get the MCP Tool definition for this agent.
   * This allows the agent to be invoked as a tool by other agents or clients.
   *
   * @returns Tool definition with name, description, and input schema
   */
  override getToolDefinition(): Tool {
    const metadata = this.record.metadata;

    // The agent's tool entry is the single source of its input JSON Schema; convert here only without one
    let inputSchema: Tool['inputSchema'] = {
      type: 'object',
      properties: {},
    };

    const toolInputSchema = this.agentToolInstance?.getInputJsonSchema();
    if (toolInputSchema) {
      inputSchema = toolInputSchema as Tool['inputSchema'];
    } else if (this.inputSchema && Object.keys(this.inputSchema).length > 0) {
      try {
        inputSchema = toJSONSchema(z.object(this.inputSchema), {
          io: 'input',
          unrepresentable: 'any',
        }) as Tool['inputSchema'];
      } catch {
        // Fallback to empty schema if conversion fails
        this.scope.logger.warn(`Failed to convert input schema for agent ${this.name}`);
      }
    }

    return {
      name: agentToolName(this.id),
      description: this.buildToolDescription(metadata),
      inputSchema,
    };
  }

  /**
   * Build the tool description from metadata.
   */
  private buildToolDescription(metadata: typeof this.record.metadata): string {
    if (metadata.description) {
      return metadata.description;
    }

    const baseDescription = `Invoke the ${metadata.name} agent.`;
    if (metadata.systemInstructions) {
      return `${baseDescription} ${metadata.systemInstructions.slice(0, 100)}...`;
    }

    return baseDescription;
  }

  override isVisibleToSwarm(): boolean {
    return isAgentVisibleToSwarm(this.record.metadata);
  }

  override canSeeSwarm(): boolean {
    return canAgentSeeSwarm(this.record.metadata);
  }

  override getVisibleAgentIds(): string[] {
    return getVisibleAgentIds(this.record.metadata) ?? [];
  }
}

// ============================================================================
// Function-based Agent Context
// ============================================================================

/**
 * Agent context for function-based agents created with `agent()`.
 */
class FunctionAgentContext<
  InSchema extends ToolInputType,
  OutSchema extends ToolOutputType,
  In = AgentInputOf<{ inputSchema: InSchema }>,
  Out = AgentOutputOf<{ outputSchema: OutSchema }>,
> extends AgentContext<InSchema, OutSchema, In, Out> {
  constructor(
    private readonly record: AgentFunctionTokenRecord,
    args: AgentCtorArgs<In>,
  ) {
    super(args);
  }

  /** Runs the handler given to `agent(options)(handler)`, which `record.provide()` returns. */
  override async execute(input: In): Promise<Out> {
    const handler = this.record.provide();
    return (await handler(input, this)) as Out;
  }
}
