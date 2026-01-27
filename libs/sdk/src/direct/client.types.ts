/**
 * Direct Client Types
 *
 * Types for connecting to FrontMCP servers as an MCP client with LLM-aware responses.
 */

import type {
  ServerCapabilities,
  Implementation,
  ClientCapabilities,
  ListResourcesResult,
  ReadResourceResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  GetPromptResult,
  CompleteResult,
  LoggingLevel,
} from '@modelcontextprotocol/sdk/types.js';
import type { FormattedTools, FormattedToolResult } from './llm-platform';

// Re-export platform-specific types for convenience
export type { FormattedTools, FormattedToolResult };

/**
 * Supported LLM platforms for tool/result formatting.
 *
 * - `openai`: OpenAI function calling format
 * - `claude`: Anthropic Claude tool format
 * - `langchain`: LangChain tool schema format
 * - `vercel-ai`: Vercel AI SDK tool format
 * - `raw`: Raw MCP protocol format (no transformation)
 */
export type LLMPlatform = 'openai' | 'claude' | 'langchain' | 'vercel-ai' | 'raw';

// ═══════════════════════════════════════════════════════════════════════════
// Skills Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for searching skills.
 */
export interface SearchSkillsOptions {
  /** Filter by specific tags */
  tags?: string[];
  /** Filter by specific tools (skills must reference these tools) */
  tools?: string[];
  /** Maximum number of results (1-50, default: 10) */
  limit?: number;
  /** Require all specified tools to be available */
  requireAllTools?: boolean;
}

/**
 * A single skill search result item.
 */
export interface SkillSearchResultItem {
  /** Unique skill identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what the skill does */
  description: string;
  /** Relevance score (0-1) */
  score: number;
  /** Tags associated with the skill */
  tags?: string[];
  /** Tools referenced by this skill with availability info */
  tools: Array<{ name: string; available: boolean }>;
  /** Source of the skill */
  source: 'local' | 'external';
}

/**
 * Result of searching for skills.
 */
export interface SearchSkillsResult {
  /** List of matching skills */
  skills: SkillSearchResultItem[];
  /** Total number of matching skills */
  total: number;
  /** Whether there are more results beyond this page */
  hasMore: boolean;
  /** Guidance message for using the results */
  guidance: string;
}

/**
 * Options for loading skills.
 */
export interface LoadSkillsOptions {
  /** Format of the returned content */
  format?: 'full' | 'instructions-only';
  /** Whether to activate a skill session */
  activateSession?: boolean;
  /** Policy mode for the skill session */
  policyMode?: 'strict' | 'approval' | 'permissive';
}

/**
 * A single loaded skill item.
 */
export interface LoadedSkillItem {
  /** Unique skill identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what the skill does */
  description: string;
  /** Instructions for using the skill */
  instructions: string;
  /** Tools used by this skill with their schemas */
  tools: Array<{
    name: string;
    purpose?: string;
    available: boolean;
    inputSchema?: unknown;
    outputSchema?: unknown;
  }>;
  /** Parameters that can be passed to the skill */
  parameters?: Array<{
    name: string;
    description?: string;
    required?: boolean;
    type?: string;
  }>;
  /** Names of tools that are available */
  availableTools: string[];
  /** Names of tools that are missing */
  missingTools: string[];
  /** Whether all required tools are available */
  isComplete: boolean;
  /** Formatted content for LLM consumption */
  formattedContent: string;
  /** Session info if activateSession was true */
  session?: {
    activated: boolean;
    sessionId?: string;
    policyMode?: string;
    allowedTools?: string[];
  };
}

/**
 * Result of loading skills.
 */
export interface LoadSkillsResult {
  /** Loaded skills */
  skills: LoadedSkillItem[];
  /** Summary of the load operation */
  summary: {
    totalSkills: number;
    totalTools: number;
    allToolsAvailable: boolean;
    combinedWarnings?: string[];
  };
  /** Guidance for next steps */
  nextSteps: string;
}

/**
 * Options for listing skills.
 */
export interface ListSkillsOptions {
  /** Number of skills to skip (for pagination) */
  offset?: number;
  /** Maximum number of skills to return */
  limit?: number;
  /** Filter by specific tags */
  tags?: string[];
  /** Field to sort by */
  sortBy?: 'name' | 'priority' | 'createdAt';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  /** Include hidden skills */
  includeHidden?: boolean;
}

/**
 * Result of listing skills.
 */
export interface ListSkillsResult {
  /** List of skills */
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags?: string[];
    priority?: number;
  }>;
  /** Total number of skills matching the filter */
  total: number;
  /** Whether there are more skills beyond this page */
  hasMore: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Elicitation Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An elicitation request from the server.
 */
export interface ElicitationRequest {
  /** Unique identifier for this elicitation */
  elicitId: string;
  /** Message to display to the user */
  message: string;
  /** JSON Schema for the expected response */
  requestedSchema: Record<string, unknown>;
  /** Mode of elicitation */
  mode: 'form' | 'url';
  /** Timestamp when the elicitation expires */
  expiresAt: number;
}

/**
 * Response to an elicitation request.
 */
export interface ElicitationResponse {
  /** User's action */
  action: 'accept' | 'cancel' | 'decline';
  /** Content if action is 'accept' */
  content?: unknown;
}

/**
 * Handler function for elicitation requests.
 */
export type ElicitationHandler = (request: ElicitationRequest) => ElicitationResponse | Promise<ElicitationResponse>;

// ═══════════════════════════════════════════════════════════════════════════
// Completion Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for argument completion.
 */
export interface CompleteOptions {
  /** Reference to the prompt or resource */
  ref: { type: 'ref/prompt'; name: string } | { type: 'ref/resource'; uri: string };
  /** The argument to complete */
  argument: { name: string; value: string };
}

// Re-export CompleteResult from MCP SDK
export type { CompleteResult };

// ═══════════════════════════════════════════════════════════════════════════
// Logging Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * MCP logging levels per spec.
 * Re-export from MCP SDK for convenience.
 */
export type McpLogLevel = LoggingLevel;

/**
 * Client info for MCP protocol handshake.
 * Used to identify the client and detect LLM platform.
 */
export interface ClientInfo {
  /** Client name (e.g., 'openai', 'my-agent') */
  name: string;
  /** Client version */
  version: string;
}

/**
 * Session options for connection.
 */
export interface SessionOptions {
  /** Session ID (auto-generated if not provided) */
  id?: string;
  /** User information for auth context */
  user?: {
    /** User subject identifier */
    sub?: string;
    /** User display name */
    name?: string;
    /** User email */
    email?: string;
    /** Additional user claims */
    [key: string]: unknown;
  };
}

/**
 * Full connect options for generic `connect()` function.
 *
 * @example
 * ```typescript
 * const client = await connect(MyServer, {
 *   clientInfo: { name: 'my-agent', version: '1.0.0' },
 *   session: { id: 'session-123', user: { sub: 'user-1' } },
 *   authToken: 'jwt-token',
 *   capabilities: { tools: true },
 * });
 * ```
 */
export interface ConnectOptions {
  /** MCP client info for handshake (used for platform detection) */
  clientInfo?: ClientInfo;
  /** Session configuration */
  session?: SessionOptions;
  /** Direct auth token injection (e.g., JWT) */
  authToken?: string;
  /** Optional client capabilities override */
  capabilities?: Partial<ClientCapabilities>;
}

/**
 * Simplified connect options for LLM-specific helpers.
 *
 * @example
 * ```typescript
 * const client = await connectOpenAI(MyServer, {
 *   session: { id: 'session-123' },
 *   authToken: 'jwt-token',
 * });
 * ```
 */
export interface LLMConnectOptions {
  /** Session configuration */
  session?: SessionOptions;
  /** Direct auth token injection (e.g., JWT) */
  authToken?: string;
  /** Optional client capabilities override */
  capabilities?: Partial<ClientCapabilities>;
}

/**
 * Connected client interface for interacting with FrontMCP servers.
 *
 * The client provides MCP operations with responses formatted for the detected LLM platform.
 * Tools are automatically formatted for OpenAI, Claude, LangChain, or Vercel AI SDK.
 *
 * @example
 * ```typescript
 * import { connectOpenAI } from '@frontmcp/sdk';
 *
 * const client = await connectOpenAI(MyServer, { authToken: 'token' });
 *
 * // Tools are already in OpenAI format
 * const tools = await client.listTools();
 *
 * // Call and get formatted result
 * const result = await client.callTool('weather', { city: 'NYC' });
 *
 * await client.close();
 * ```
 */
export interface DirectClient {
  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Operations (format varies by LLM platform)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List all available tools, formatted for the detected LLM platform.
   *
   * Return format depends on platform:
   * - OpenAI: `[{ type: 'function', function: { name, description, parameters, strict } }]`
   * - Claude: `[{ name, description, input_schema }]`
   * - LangChain: `[{ name, description, schema }]`
   * - Vercel AI: `{ [name]: { description, parameters } }`
   * - Raw: MCP `Tool[]` format
   */
  listTools(): Promise<FormattedTools>;

  /**
   * Call a tool and get the result, formatted for the detected LLM platform.
   *
   * @param name - Tool name
   * @param args - Tool arguments
   */
  callTool(name: string, args?: Record<string, unknown>): Promise<FormattedToolResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Resource Operations (raw MCP format)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List all available resources.
   */
  listResources(): Promise<ListResourcesResult>;

  /**
   * Read a resource by URI.
   *
   * @param uri - Resource URI
   */
  readResource(uri: string): Promise<ReadResourceResult>;

  /**
   * List all available resource templates.
   */
  listResourceTemplates(): Promise<ListResourceTemplatesResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Prompt Operations (raw MCP format)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List all available prompts.
   */
  listPrompts(): Promise<ListPromptsResult>;

  /**
   * Get a prompt with arguments.
   *
   * @param name - Prompt name
   * @param args - Prompt arguments
   */
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Info
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get the session ID for this connection */
  getSessionId(): string;

  /** Get the client info used for the connection */
  getClientInfo(): ClientInfo;

  /** Get the server info from the MCP handshake */
  getServerInfo(): Implementation;

  /** Get the server capabilities from the MCP handshake */
  getCapabilities(): ServerCapabilities;

  /** Get the detected LLM platform (based on clientInfo) */
  getDetectedPlatform(): LLMPlatform;

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Close the connection and cleanup resources.
   */
  close(): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Skills Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Search for skills matching a query.
   *
   * @param query - Search query string
   * @param options - Search options
   * @returns Matching skills with relevance scores
   */
  searchSkills(query: string, options?: SearchSkillsOptions): Promise<SearchSkillsResult>;

  /**
   * Load one or more skills by ID.
   *
   * @param skillIds - Array of skill IDs to load
   * @param options - Load options
   * @returns Loaded skills with their content and tool info
   */
  loadSkills(skillIds: string[], options?: LoadSkillsOptions): Promise<LoadSkillsResult>;

  /**
   * List all available skills.
   *
   * @param options - List options (pagination, filtering)
   * @returns Paginated list of skills
   */
  listSkills(options?: ListSkillsOptions): Promise<ListSkillsResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Elicitation Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register a handler for elicitation requests.
   *
   * When a tool calls `this.elicit()`, the handler will be invoked with the
   * elicitation details. Return the user's response.
   *
   * @param handler - Function to handle elicitation requests
   * @returns Unsubscribe function
   */
  onElicitation(handler: ElicitationHandler): () => void;

  /**
   * Submit an elicitation result manually.
   *
   * Use this when handling elicitation asynchronously or through a separate channel.
   *
   * @param elicitId - The elicitation ID
   * @param response - The user's response
   */
  submitElicitationResult(elicitId: string, response: ElicitationResponse): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Completion Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Request argument completion for a prompt or resource.
   *
   * @param options - Completion options (ref and argument)
   * @returns Completion suggestions
   */
  complete(options: CompleteOptions): Promise<CompleteResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Resource Subscription Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to updates for a resource.
   *
   * @param uri - Resource URI to subscribe to
   */
  subscribeResource(uri: string): Promise<void>;

  /**
   * Unsubscribe from updates for a resource.
   *
   * @param uri - Resource URI to unsubscribe from
   */
  unsubscribeResource(uri: string): Promise<void>;

  /**
   * Register a handler for resource update notifications.
   *
   * @param handler - Function called when a subscribed resource is updated
   * @returns Unsubscribe function
   */
  onResourceUpdated(handler: (uri: string) => void): () => void;

  // ─────────────────────────────────────────────────────────────────────────────
  // Logging Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set the logging level for the server.
   *
   * @param level - The logging level
   */
  setLogLevel(level: McpLogLevel): Promise<void>;
}
