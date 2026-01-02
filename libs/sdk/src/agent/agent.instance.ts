// file: libs/sdk/src/agent/agent.instance.ts

import { z } from 'zod';
import { toJSONSchema } from 'zod/v4';
import { Token } from '@frontmcp/di';
import {
  EntryOwnerRef,
  AgentCallArgs,
  AgentCallExtra,
  AgentContext,
  AgentCtorArgs,
  AgentEntry,
  AgentRecord,
  AgentKind,
  AgentFunctionTokenRecord,
  ParsedAgentResult,
  SafeTransformResult,
  ToolInputType,
  ToolOutputType,
  AgentInputOf,
  AgentOutputOf,
  AgentLlmAdapter,
  AgentToolDefinition,
  ToolEntry,
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import HookRegistry from '../hooks/hook.registry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { createAdapter, CreateAdapterOptions } from './adapters';
import type { CallToolRequest, Tool } from '@modelcontextprotocol/sdk/types.js';
import { InvalidHookFlowError, AgentNotConfiguredError, AgentToolNotFoundError } from '../errors';
import { agentToolName, isAgentVisibleToSwarm, canAgentSeeSwarm, getVisibleAgentIds } from './agent.utils';
import { buildParsedToolResult, buildAgentToolDefinitions } from '../tool/tool.utils';
import { ToolExecutor } from './agent-execution-loop';
import { AgentScope } from './agent.scope';
import type { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Constants
// ============================================================================

/** Valid flow names for agent hooks */
const VALID_AGENT_HOOK_FLOWS = ['agents:call-agent', 'agents:list-agents'] as const;

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
  private readonly providers: ProviderRegistry;
  readonly scope: Scope;
  readonly hooks: HookRegistry;

  /** The LLM adapter for this agent */
  private llmAdapter: AgentLlmAdapter | null = null;

  /** Agent-scoped tools (from @Agent({ tools: [...] })) */
  private agentTools: ToolEntry[] = [];

  /** Agent's private scope (like a private app with its own registries) */
  private agentScope: AgentScope | null = null;

  constructor(record: AgentRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providers = providers;
    this.name = record.metadata.id ?? record.metadata.name;
    this.id = record.metadata.id ?? record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this.providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

    // Initialize input schema
    const schema: unknown = record.metadata.inputSchema;
    // Support both Zod objects and raw ZodRawShape
    this.inputSchema = (schema instanceof z.ZodObject ? schema.shape : schema ?? {}) as InSchema;

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

    // Create LLM adapter from configuration
    await this.initializeLlmAdapter();

    // Register hooks from the agent class
    await this.registerHooks();
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
      return;
    }

    // Create the agent's private scope
    this.agentScope = new AgentScope(this.scope, this.id, metadata, this.record.provide);

    await this.agentScope.ready;

    // Get tool instances from the agent scope for tool definitions
    this.agentTools = this.agentScope.tools.getTools(true);

    this.scope.logger.info(
      `Agent ${this.name} initialized with AgentScope: ${this.agentTools.length} tool(s), ${
        metadata.plugins?.length ?? 0
      } plugin(s)`,
    );
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

    const adapterOptions: CreateAdapterOptions = {
      providerResolver: {
        get: <T>(token: Token<T>): T => {
          return this.providers.get(token);
        },
        tryGet: <T>(token: Token<T>) => {
          try {
            return this.providers.get(token);
          } catch {
            return undefined;
          }
        },
      },
    };

    try {
      this.llmAdapter = createAdapter(llmConfig, adapterOptions);
    } catch (error) {
      this.scope.logger.error(`Failed to create LLM adapter for agent ${this.name}`, error);
      throw error;
    }
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

    const agentCtorArgs = this.buildAgentCtorArgs(input, ctx);

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
        return this.record.useFactory(this.providers) as AgentContext<InSchema, OutSchema, In, Out>;
    }
    // Note: TypeScript already ensures exhaustiveness through AgentKind enum.
    // The switch covers all AgentKind values, so this point is unreachable.
  }

  /**
   * Build the constructor arguments for creating an AgentContext.
   */
  private buildAgentCtorArgs(input: AgentCallArgs, ctx: AgentCallExtra): AgentCtorArgs<In> {
    const scope = this.providers.getActiveScope();

    return {
      metadata: this.metadata,
      input: input as In,
      providers: this.providers,
      logger: scope.logger,
      authInfo: ctx.authInfo,
      llmAdapter: this.llmAdapter!,
      toolDefinitions: this.getToolDefinitions(),
      toolExecutor: this.createToolExecutor(ctx),
    };
  }

  /**
   * Get tool definitions available to this agent.
   * Returns only the agent's own tools (from @Agent({ tools: [...] })).
   */
  private getToolDefinitions(): AgentToolDefinition[] {
    // Use only the agent's own tools (not scope tools)
    return buildAgentToolDefinitions(this.agentTools);
  }

  /**
   * Create a tool executor for agent-scoped tools.
   *
   * When `execution.useToolFlow` is enabled (default: true), tool calls are routed
   * through the agent's private scope's call-tool flow. This enables full lifecycle
   * support including:
   * - Plugin integration (cache, PII, rate limiting, etc.)
   * - Hook execution (will/did/around stages)
   * - Authorization checks
   * - UI rendering
   * - MCP-compliant error handling
   *
   * When `execution.useToolFlow` is false, tools are executed directly for
   * performance-critical scenarios.
   *
   * @param ctx - Extra context including authInfo
   * @returns A function that executes tools by name
   */
  private createToolExecutor(ctx: AgentCallExtra): ToolExecutor {
    const useToolFlow = this.record.metadata.execution?.useToolFlow !== false;

    return async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
      const tool = this.agentTools.find((t) => t.name === toolName || t.fullName === toolName);

      if (!tool) {
        throw new AgentToolNotFoundError(
          this.name,
          toolName,
          this.agentTools.map((t) => t.name),
        );
      }

      // Use the agent's private scope if available and useToolFlow is enabled
      if (useToolFlow && this.agentScope) {
        // Route through the agent scope's call-tool flow for full lifecycle support
        const result = await this.agentScope.runFlowForOutput('tools:call-tool', {
          request: {
            method: 'tools/call',
            params: { name: tool.fullName, arguments: args },
          },
          ctx: {
            authInfo: ctx.authInfo,
            _skipUI: true, // Skip UI rendering - agent returns structured data
          },
        });

        // Extract the actual result from MCP CallToolResult format
        return this.extractToolResult(result);
      }

      // Direct execution - faster but bypasses plugins/hooks
      const toolContext = tool.create(args, ctx);
      return toolContext.execute(args);
    };
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
        throw new Error((errorContent as TextContent).text);
      }
      throw new Error('Tool execution failed');
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

    // Convert input schema to JSON Schema using toJSONSchema utility
    let inputSchema: Tool['inputSchema'] = {
      type: 'object',
      properties: {},
    };

    if (this.inputSchema && Object.keys(this.inputSchema).length > 0) {
      try {
        inputSchema = toJSONSchema(z.object(this.inputSchema)) as Tool['inputSchema'];
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
  constructor(private readonly record: AgentFunctionTokenRecord, args: AgentCtorArgs<In>) {
    super(args);
  }

  override async execute(input: In): Promise<Out> {
    return this.record.provide(input, this);
  }
}
