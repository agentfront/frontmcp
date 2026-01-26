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
} from '@modelcontextprotocol/sdk/types.js';

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
  listTools(): Promise<unknown>;

  /**
   * Call a tool and get the result, formatted for the detected LLM platform.
   *
   * @param name - Tool name
   * @param args - Tool arguments
   */
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;

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
}
