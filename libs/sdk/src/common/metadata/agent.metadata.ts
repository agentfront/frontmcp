import { z } from 'zod';
import { FuncType, Type, Token } from '@frontmcp/di';
import { RawZodShape } from '../types';
import { ProviderType } from '../interfaces/provider.interface';
import { PluginType } from '../interfaces/plugin.interface';
import { AdapterType } from '../interfaces/adapter.interface';
import { ToolType } from '../interfaces/tool.interface';
import { ResourceType } from '../interfaces/resource.interface';
import { PromptType } from '../interfaces/prompt.interface';
import {
  annotatedFrontMcpAdaptersSchema,
  annotatedFrontMcpAgentsSchema,
  annotatedFrontMcpPluginsSchema,
  annotatedFrontMcpPromptsSchema,
  annotatedFrontMcpProvidersSchema,
  annotatedFrontMcpResourcesSchema,
  annotatedFrontMcpToolsSchema,
} from '../schemas';
import { ToolInputType, ToolOutputType } from './tool.metadata';

/**
 * Agent type definition (class or factory function).
 * Used in app/plugin metadata for defining agents.
 */
export type AgentType<T = unknown> = Type<T> | FuncType<T>;

declare global {
  /**
   * Declarative metadata extends to the McpAgent decorator.
   * Extends ExtendFrontMcpToolMetadata so agents can use plugin metadata
   * options (e.g., cache, codecall) since agents are exposed as tools.
   * Uses interface for declaration merging support.
   */
  interface ExtendFrontMcpAgentMetadata extends ExtendFrontMcpToolMetadata {}
}

// ============================================================================
// LLM Adapter Configuration Types
// ============================================================================

/**
 * Supported LLM providers for the built-in adapter shorthand.
 */
export type AgentLlmProviderType = 'openai' | 'anthropic' | 'google' | 'mistral' | 'groq';

/**
 * Helper type for resolving configuration from app config paths.
 * @example withConfig('llm.openai.apiKey')
 */
export interface WithConfig<T = string> {
  /**
   * Dot-notation path to resolve from app configuration.
   * @example 'llm.openai.apiKey' or 'agents.research.model'
   */
  configPath: string;

  /**
   * Optional transform function to convert the raw config value.
   */
  transform?: (value: unknown) => T;
}

/**
 * Factory function to create a WithConfig reference.
 */
export function withConfig<T = string>(configPath: string, transform?: (value: unknown) => T): WithConfig<T> {
  return { configPath, transform };
}

/**
 * API key configuration - supports direct string, environment variable, or config path.
 */
export type AgentApiKeyConfig = string | { env: string } | WithConfig<string>;

/**
 * Built-in provider shorthand configuration.
 * Use this for quick setup with standard LLM providers.
 * The SDK will auto-create the appropriate LangChain adapter.
 */
export interface AgentLlmBuiltinConfig {
  /**
   * LLM provider to use.
   */
  provider: AgentLlmProviderType;

  /**
   * Model identifier (e.g., 'gpt-4-turbo', 'claude-3-opus').
   */
  model: string | WithConfig;

  /**
   * API key for the LLM provider.
   */
  apiKey: AgentApiKeyConfig;

  /**
   * Optional base URL for custom/self-hosted endpoints.
   */
  baseUrl?: string | WithConfig;

  /**
   * Default temperature for generations (0-2).
   */
  temperature?: number;

  /**
   * Maximum tokens for responses.
   */
  maxTokens?: number;
}

/**
 * Interface for LLM adapter (local type for use in metadata).
 * Full interface with same name defined in llm-adapter.interface.ts
 * This is intentionally a separate type to avoid circular dependencies.
 */
interface AgentLlmAdapterLocal {
  completion(prompt: unknown, tools?: unknown[], options?: unknown): Promise<unknown>;
  streamCompletion?(prompt: unknown, tools?: unknown[], options?: unknown): AsyncGenerator<unknown>;
}

/**
 * Direct adapter instance or factory configuration.
 * Use this for custom LLM integrations or complex setups.
 */
export interface AgentLlmAdapterConfig {
  /**
   * Direct adapter instance or factory function.
   * Factory receives ProviderRegistry for dependency injection.
   */
  adapter: AgentLlmAdapterLocal | ((providers: unknown) => AgentLlmAdapterLocal);
}

/**
 * Combined LLM configuration type.
 * Supports built-in adapters, custom adapters, or DI token injection.
 *
 * Note: AgentLlmAdapter is defined in llm-adapter.interface.ts
 * Use Token<any> here to avoid circular dependency; runtime validation
 * will check the adapter instance.
 */
export type AgentLlmConfig = AgentLlmBuiltinConfig | AgentLlmAdapterConfig | Token<unknown>; // Token for DI injection (AgentLlmAdapter)

// ============================================================================
// Swarm Configuration
// ============================================================================

/**
 * Configuration for agent swarm capabilities (agent-to-agent communication).
 */
export interface AgentSwarmConfig {
  /**
   * Whether this agent can see and invoke other agents as tools.
   * @default false (agents are isolated by default)
   */
  canSeeOtherAgents?: boolean;

  /**
   * Explicit whitelist of agent IDs this agent can see.
   * If undefined and canSeeOtherAgents=true, sees all registered agents.
   */
  visibleAgents?: string[];

  /**
   * Whether this agent is visible to other agents.
   * @default true (agents are discoverable unless hidden)
   */
  isVisible?: boolean;

  /**
   * Maximum depth for agent-to-agent calls (prevents infinite loops).
   * @default 3
   */
  maxCallDepth?: number;
}

// ============================================================================
// Execution Configuration
// ============================================================================

/**
 * Configuration for agent execution behavior.
 */
export interface AgentExecutionConfig {
  /**
   * Maximum execution time in milliseconds.
   * @default 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Maximum iterations for the agent loop.
   * @default 10
   */
  maxIterations?: number;

  /**
   * Enable streaming responses via SSE/WebSocket.
   * @default false
   */
  enableStreaming?: boolean;

  /**
   * Enable MCP notifications for progress updates.
   * @default true
   */
  enableNotifications?: boolean;

  /**
   * Interval for progress notifications in milliseconds.
   * @default 1000
   */
  notificationInterval?: number;

  /**
   * Whether to inherit parent scope's tools.
   * @default true
   */
  inheritParentTools?: boolean;

  /**
   * Whether to execute tools through the call-tool flow (with plugins, hooks, authorization).
   * When true, tool calls go through the full MCP flow with all middleware.
   * When false, tools are executed directly for performance-critical scenarios.
   * @default true
   */
  useToolFlow?: boolean;

  /**
   * Whether to inherit plugins from the parent scope.
   * When true, the agent's tools will benefit from standard plugin extensions
   * (e.g., cache, codecall) registered in the parent scope.
   * @default true
   */
  inheritPlugins?: boolean;
}

// ============================================================================
// Export Configuration
// ============================================================================

/**
 * Configuration for exporting agent resources/prompts to parent scope.
 */
export interface AgentExportsConfig {
  /**
   * Resources to export to parent scope.
   * Use '*' to export all resources.
   */
  resources?: ResourceType[] | '*';

  /**
   * Prompts to export to parent scope.
   * Use '*' to export all prompts.
   */
  prompts?: PromptType[] | '*';

  /**
   * Providers to export to parent scope.
   */
  providers?: ProviderType[];
}

// ============================================================================
// Agent Metadata Interface
// ============================================================================

/**
 * Declarative metadata describing an autonomous Agent in FrontMCP.
 *
 * Agents are self-contained units with their own LLM provider, isolated scope
 * (tools, resources, prompts, providers, hooks), and the ability to be invoked
 * as tools by other agents or the parent app.
 *
 * @example
 * ```typescript
 * @Agent({
 *   name: 'research-agent',
 *   description: 'Researches topics and compiles reports',
 *   systemInstructions: 'You are a research assistant...',
 *   llm: {
 *     adapter: 'openai',
 *     model: 'gpt-4-turbo',
 *     apiKey: { env: 'OPENAI_API_KEY' },
 *   },
 *   tools: [WebSearchTool, SummarizeTool],
 *   swarm: { canSeeOtherAgents: true },
 * })
 * export default class ResearchAgent extends AgentContext { ... }
 * ```
 */
export interface AgentMetadata<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
> extends ExtendFrontMcpAgentMetadata {
  /**
   * Unique identifier for the agent.
   * Used for tool routing (use-agent:<id>) and swarm discovery.
   * If omitted, derived from the class name or 'name' property.
   */
  id?: string;

  /**
   * Human-readable name of the agent.
   * This becomes the base for the tool name when the agent is exposed as a tool.
   */
  name: string;

  /**
   * Description of what the agent does.
   * Used in tool discovery and as context for LLM system instructions.
   */
  description?: string;

  /**
   * System instructions for the agent.
   * Defines the agent's persona, capabilities, and behavior.
   */
  systemInstructions?: string;

  /**
   * Zod schema for the agent's input (what triggers the agent).
   * Becomes the tool's inputSchema when agent is exposed as a tool.
   */
  inputSchema?: InSchema;

  /**
   * Zod schema for the agent's output.
   * Becomes the tool's outputSchema when agent is exposed as a tool.
   */
  outputSchema?: OutSchema;

  /**
   * LLM configuration for the agent.
   * Supports built-in adapters, custom adapters, or DI token injection.
   */
  llm: AgentLlmConfig;

  // ---- Agent-scoped components (similar to plugin structure) ----

  /**
   * Agent-scoped providers (dependencies).
   */
  providers?: ProviderType[];

  /**
   * Agent-scoped plugins for additional capabilities.
   */
  plugins?: PluginType[];

  /**
   * Agent-scoped adapters for external integrations.
   */
  adapters?: AdapterType[];

  /**
   * Nested agents - agents inside this agent!
   * Nested agents are automatically registered as tools within the parent agent's scope.
   */
  agents?: AgentType[];

  /**
   * Agent-scoped tools available to the agent's LLM.
   */
  tools?: ToolType[];

  /**
   * Agent-scoped resources.
   */
  resources?: ResourceType[];

  /**
   * Agent-scoped prompts.
   */
  prompts?: PromptType[];

  // ---- Configuration options ----

  /**
   * Resources, prompts, and providers to export to parent scope.
   */
  exports?: AgentExportsConfig;

  /**
   * Swarm configuration for agent-to-agent communication.
   */
  swarm?: AgentSwarmConfig;

  /**
   * Execution configuration.
   */
  execution?: AgentExecutionConfig;

  /**
   * Tags for categorization and filtering.
   */
  tags?: string[];

  /**
   * Whether to hide this agent from discovery.
   * The agent can still be invoked by name if known.
   * @default false
   */
  hideFromDiscovery?: boolean;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

const withConfigSchema = z.object({
  configPath: z.string().min(1),
  transform: z.function().optional(),
});

const apiKeyConfigSchema = z.union([z.string(), z.object({ env: z.string() }), withConfigSchema]);

const builtinAdapterConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'mistral', 'groq']),
  model: z.union([z.string(), withConfigSchema]),
  apiKey: apiKeyConfigSchema,
  baseUrl: z.union([z.string(), withConfigSchema]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});

const adapterConfigSchema = z.object({
  adapter: z.union([z.instanceof(Object), z.function()]),
});

const llmConfigSchema = z.union([
  builtinAdapterConfigSchema,
  adapterConfigSchema,
  z.custom<symbol>((v) => typeof v === 'symbol', { message: 'Must be a symbol token' }), // Token<AgentLlmAdapter>
  // Allow direct adapter instances (must have completion method)
  z.custom<AgentLlmAdapterLocal>(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      'completion' in v &&
      typeof (v as AgentLlmAdapterLocal).completion === 'function',
    { message: 'Must be an adapter instance with completion method' },
  ),
]);

const swarmConfigSchema = z.object({
  canSeeOtherAgents: z.boolean().optional().default(false),
  visibleAgents: z.array(z.string()).optional(),
  isVisible: z.boolean().optional().default(true),
  maxCallDepth: z.number().min(1).max(10).optional().default(3),
});

const executionConfigSchema = z.object({
  timeout: z.number().positive().optional().default(120000),
  maxIterations: z.number().min(1).max(100).optional().default(10),
  enableStreaming: z.boolean().optional().default(false),
  enableNotifications: z.boolean().optional().default(true),
  notificationInterval: z.number().positive().optional().default(1000),
  inheritParentTools: z.boolean().optional().default(true),
  useToolFlow: z.boolean().optional().default(true),
  // Default false: inner agent tools use agent's own plugins only.
  // The agent itself (as use-agent:* tool) goes through parent scope's plugins.
  inheritPlugins: z.boolean().optional().default(false),
});

const exportsConfigSchema = z.object({
  resources: z.union([z.array(z.any()), z.literal('*')]).optional(),
  prompts: z.union([z.array(z.any()), z.literal('*')]).optional(),
  providers: z.array(z.any()).optional(),
});

/**
 * Zod schema for validating AgentMetadata at runtime.
 */
export const frontMcpAgentMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    systemInstructions: z.string().optional(),
    inputSchema: z.instanceof(Object).optional(),
    outputSchema: z.any().optional(),
    llm: llmConfigSchema,
    providers: z.array(annotatedFrontMcpProvidersSchema).optional(),
    plugins: z.array(annotatedFrontMcpPluginsSchema).optional(),
    adapters: z.array(annotatedFrontMcpAdaptersSchema).optional(),
    agents: z.array(annotatedFrontMcpAgentsSchema).optional(),
    tools: z.array(annotatedFrontMcpToolsSchema).optional(),
    resources: z.array(annotatedFrontMcpResourcesSchema).optional(),
    prompts: z.array(annotatedFrontMcpPromptsSchema).optional(),
    exports: exportsConfigSchema.optional(),
    swarm: swarmConfigSchema.optional(),
    execution: executionConfigSchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
    hideFromDiscovery: z.boolean().optional().default(false),
  } satisfies RawZodShape<AgentMetadata, ExtendFrontMcpAgentMetadata>)
  .passthrough();
