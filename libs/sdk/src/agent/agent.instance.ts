// file: libs/sdk/src/agent/agent.instance.ts

import { z } from 'zod';
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
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import HookRegistry from '../hooks/hook.registry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { createAdapter, CreateAdapterOptions } from './adapters';
import type { CallToolRequest, CallToolResult, Tool, TextContent } from '@modelcontextprotocol/sdk/types.js';
import { InvalidHookFlowError } from '../errors';
import { agentToolName, isAgentVisibleToSwarm, canAgentSeeSwarm, getVisibleAgentIds } from './agent.utils';
import { buildParsedToolResult, buildAgentToolDefinitions } from '../tool/tool.utils';
import { ToolExecutor } from './agent-execution-loop';

// ============================================================================
// Agent Instance
// ============================================================================

/**
 * Concrete implementation of AgentEntry.
 *
 * AgentInstance manages an agent's lifecycle, including:
 * - LLM adapter initialization
 * - Agent-scoped registries (if using isolated scope)
 * - Hook registration
 * - Input/output parsing
 * - Tool definition generation
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
    // Create LLM adapter from configuration
    await this.initializeLlmAdapter();

    // Register hooks from the agent class
    await this.registerHooks();
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
        get: <T>(token: symbol | { new (...args: unknown[]): T }): T => {
          return this.providers.get(token as unknown as never) as T;
        },
        tryGet: <T>(token: symbol | { new (...args: unknown[]): T }): T | undefined => {
          try {
            return this.providers.get(token as unknown as never) as T;
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
   */
  private async registerHooks(): Promise<void> {
    // Valid flows for agent hooks
    const validFlows = ['agents:call-agent', 'agents:list-agents'];

    const allHooks = normalizeHooksFromCls(this.record.provide);

    // Separate valid and invalid hooks
    const validHooks = allHooks.filter((hook) => validFlows.includes(hook.metadata.flow));
    const invalidHooks = allHooks.filter((hook) => !validFlows.includes(hook.metadata.flow));

    // Throw error for invalid hooks (fail fast)
    if (invalidHooks.length > 0) {
      const className = (this.record.provide as { name?: string })?.name ?? 'Unknown';
      const invalidFlowNames = invalidHooks.map((h) => h.metadata.flow).join(', ');
      throw new InvalidHookFlowError(
        `Agent "${className}" has hooks for unsupported flows: ${invalidFlowNames}. ` +
          `Only agent flows (${validFlows.join(', ')}) are supported on agent classes.`,
      );
    }

    // Register valid hooks
    if (validHooks.length > 0) {
      await this.hooks.registerHooks(true, ...validHooks);
    }
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

  override create(input: AgentCallArgs, ctx: AgentCallExtra): AgentContext<InSchema, OutSchema, In, Out> {
    const metadata = this.metadata;
    const providers = this.providers;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    if (!this.llmAdapter) {
      throw new Error(`Agent ${this.name} has no LLM adapter configured`);
    }

    // Get tool definitions for the agent
    const toolDefinitions = this.getToolDefinitions();

    // Create tool executor that calls the scope's tool registry
    const toolExecutor = this.createToolExecutor(ctx);

    const agentCtorArgs: AgentCtorArgs<In> = {
      metadata,
      input: input as In,
      providers,
      logger,
      authInfo,
      llmAdapter: this.llmAdapter,
      toolDefinitions,
      toolExecutor,
    };

    switch (this.record.kind) {
      case AgentKind.CLASS_TOKEN:
        return new this.record.provide(agentCtorArgs) as AgentContext<InSchema, OutSchema, In, Out>;

      case AgentKind.FUNCTION:
        return new FunctionAgentContext<InSchema, OutSchema, In, Out>(
          this.record as AgentFunctionTokenRecord,
          agentCtorArgs,
        );

      case AgentKind.VALUE:
        // For VALUE kind, useValue should be an AgentContext instance
        return this.record.useValue as AgentContext<InSchema, OutSchema, In, Out>;

      case AgentKind.FACTORY: {
        // For FACTORY kind, we need to call the factory
        const factoryResult = this.record.useFactory(providers);
        return factoryResult as AgentContext<InSchema, OutSchema, In, Out>;
      }
    }
  }

  /**
   * Get tool definitions available to this agent.
   * Combines agent-scoped tools with visible scope tools.
   */
  private getToolDefinitions(): AgentToolDefinition[] {
    // Get tools from scope's tool registry
    const tools = this.scope.tools?.getTools(true) ?? [];

    // Use shared utility to build agent tool definitions
    const definitions = buildAgentToolDefinitions(tools);

    // TODO: Add agent-scoped tools when agent has isolated scope

    return definitions;
  }

  /**
   * Create a tool executor that calls the scope's tool registry.
   * By default, executes tools through the call-tool flow (with plugins, hooks, authorization).
   * Can be configured to use direct execution for performance-critical scenarios.
   */
  private createToolExecutor(ctx: AgentCallExtra): ToolExecutor {
    const useFlow = this.record.metadata.execution?.useToolFlow !== false;

    return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      if (useFlow) {
        // Execute through full tool flow (with plugins, hooks, authorization)
        const result = await this.scope.runFlow<'tools:call-tool'>('tools:call-tool', {
          request: {
            method: 'tools/call',
            params: { name, arguments: args },
          },
          ctx: { authInfo: ctx.authInfo },
        });

        // Extract actual result from MCP CallToolResult
        return this.extractToolResult(result);
      } else {
        // Direct execution (for performance-critical scenarios)
        const tools = this.scope.tools?.getTools(true) ?? [];
        const tool = tools.find((t) => t.name === name || t.fullName === name);
        if (!tool) {
          throw new Error(`Tool not found: ${name}`);
        }

        // Create tool context and execute
        const toolContext = tool.create(args, ctx);
        return toolContext.execute(args);
      }
    };
  }

  /**
   * Extract the actual result from MCP CallToolResult format.
   * Same pattern as CodeCall plugin's `extractResultFromCallToolResult`.
   */
  private extractToolResult(mcpResult: CallToolResult | undefined): unknown {
    if (!mcpResult) {
      return undefined;
    }

    // If it's an error, extract the error message from content
    if (mcpResult.isError) {
      const errorContent = mcpResult.content?.[0];
      if (errorContent && errorContent.type === 'text') {
        throw new Error((errorContent as TextContent).text);
      }
      throw new Error('Tool execution failed');
    }

    // For successful results, try to extract the actual data
    const content = mcpResult.content;
    if (!content || content.length === 0) {
      return undefined;
    }

    // If there's a single text content, try to parse as JSON
    if (content.length === 1 && content[0].type === 'text') {
      const textContent = content[0] as TextContent;
      try {
        return JSON.parse(textContent.text);
      } catch {
        return textContent.text;
      }
    }

    // Return the raw content for complex results
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

  override getToolDefinition(): Tool {
    const metadata = this.record.metadata;

    // Build JSON Schema from the input schema
    let inputSchema: Tool['inputSchema'] = {
      type: 'object',
      properties: {},
    };

    // If inputSchema exists, try to convert it to JSON schema format
    if (this.inputSchema && typeof this.inputSchema === 'object') {
      const properties: Record<string, { type: string; description?: string }> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(this.inputSchema)) {
        // Basic Zod type to JSON schema conversion
        if (value && typeof value === 'object' && '_def' in value) {
          const def = (value as { _def: { typeName?: string; description?: string } })._def;
          properties[key] = {
            type: this.zodTypeToJsonType(def.typeName),
            ...(def.description ? { description: def.description } : {}),
          };
          // Mark as required if not optional
          if (def.typeName !== 'ZodOptional' && def.typeName !== 'ZodNullable') {
            required.push(key);
          }
        } else {
          properties[key] = { type: 'string' };
        }
      }

      inputSchema = {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }

    return {
      name: agentToolName(this.id),
      description:
        metadata.description ??
        `Invoke the ${metadata.name} agent.${
          metadata.systemInstructions ? ' ' + metadata.systemInstructions.slice(0, 100) + '...' : ''
        }`,
      inputSchema,
    };
  }

  /**
   * Convert Zod type name to JSON schema type.
   */
  private zodTypeToJsonType(typeName?: string): string {
    switch (typeName) {
      case 'ZodString':
        return 'string';
      case 'ZodNumber':
        return 'number';
      case 'ZodBoolean':
        return 'boolean';
      case 'ZodArray':
        return 'array';
      case 'ZodObject':
        return 'object';
      case 'ZodEnum':
        return 'string';
      default:
        return 'string';
    }
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
