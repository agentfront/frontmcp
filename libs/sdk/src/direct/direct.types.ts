/**
 * Direct MCP Server - Types and Interfaces
 *
 * Provides programmatic access to FrontMCP servers without HTTP/stdio transports.
 * Useful for embedding MCP servers in existing applications, testing, and agent backends.
 */

import type {
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  ListPromptsResult,
  GetPromptResult,
  ListResourceTemplatesResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { DirectClient, ConnectOptions } from './client.types';

/**
 * Auth context for direct server invocation.
 * Simulates what would come from JWT validation in the HTTP layer.
 */
export interface DirectAuthContext {
  /** Session ID for context tracking (auto-generated if not provided) */
  sessionId?: string;
  /** User/client token for authorization (e.g., JWT) */
  token?: string;
  /** User claims (extracted from token) */
  user?: {
    sub?: string;
    [key: string]: unknown;
  };
  /** Additional auth info (claims, scopes, etc.) */
  extra?: Record<string, unknown>;
}

/**
 * Request metadata for direct calls.
 */
export interface DirectRequestMetadata {
  /** User-Agent string */
  userAgent?: string;
  /** Client IP address */
  clientIp?: string;
  /** Custom headers matching x-frontmcp-* pattern */
  customHeaders?: Record<string, string>;
}

/**
 * Options for direct method calls.
 */
export interface DirectCallOptions {
  /** Auth context to inject (simulates JWT header) */
  authContext?: DirectAuthContext;
  /** Request metadata */
  metadata?: DirectRequestMetadata;
}

/**
 * Direct MCP server interface - bypasses HTTP transport layer.
 *
 * Provides programmatic access to MCP operations (tools, resources, prompts)
 * without requiring HTTP infrastructure.
 *
 * @example
 * ```typescript
 * import { FrontMcpInstance } from '@frontmcp/sdk';
 *
 * const server = await FrontMcpInstance.createDirect({
 *   info: { name: 'MyServer', version: '1.0.0' },
 *   apps: [MyApp],
 * });
 *
 * // List all tools
 * const { tools } = await server.listTools();
 *
 * // Call a tool with auth context
 * const result = await server.callTool('my-tool', { input: 'value' }, {
 *   authContext: { token: 'jwt-token', sessionId: 'user-123' }
 * });
 *
 * // Cleanup when done
 * await server.dispose();
 * ```
 */
export interface DirectMcpServer {
  /** Ready promise - resolves when server is initialized */
  readonly ready: Promise<void>;

  // ─────────────────────────────────────────────────────────────────
  // Tool Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all available tools.
   *
   * @param options - Optional call options with auth context
   * @returns List of tool definitions
   */
  listTools(options?: DirectCallOptions): Promise<ListToolsResult>;

  /**
   * Call a tool with arguments.
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @param options - Optional call options with auth context
   * @returns Tool execution result
   */
  callTool(name: string, args?: Record<string, unknown>, options?: DirectCallOptions): Promise<CallToolResult>;

  // ─────────────────────────────────────────────────────────────────
  // Resource Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all available resources.
   *
   * @param options - Optional call options with auth context
   * @returns List of resource definitions
   */
  listResources(options?: DirectCallOptions): Promise<ListResourcesResult>;

  /**
   * List all available resource templates.
   *
   * @param options - Optional call options with auth context
   * @returns List of resource template definitions
   */
  listResourceTemplates(options?: DirectCallOptions): Promise<ListResourceTemplatesResult>;

  /**
   * Read a resource by URI.
   *
   * @param uri - Resource URI
   * @param options - Optional call options with auth context
   * @returns Resource content
   */
  readResource(uri: string, options?: DirectCallOptions): Promise<ReadResourceResult>;

  // ─────────────────────────────────────────────────────────────────
  // Prompt Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all available prompts.
   *
   * @param options - Optional call options with auth context
   * @returns List of prompt definitions
   */
  listPrompts(options?: DirectCallOptions): Promise<ListPromptsResult>;

  /**
   * Get a prompt with arguments.
   *
   * @param name - Prompt name
   * @param args - Prompt arguments
   * @param options - Optional call options with auth context
   * @returns Prompt content with messages
   */
  getPrompt(name: string, args?: Record<string, string>, options?: DirectCallOptions): Promise<GetPromptResult>;

  // ─────────────────────────────────────────────────────────────────
  // Client Connections
  // ─────────────────────────────────────────────────────────────────

  /**
   * Connect a new MCP client to this server.
   * Each client gets its own session and in-memory transport.
   *
   * @param sessionIdOrOptions - Session ID string (shorthand) or full ConnectOptions
   * @returns Connected DirectClient instance
   */
  connect(sessionIdOrOptions?: string | ConnectOptions): Promise<DirectClient>;

  // ─────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────

  /**
   * Dispose the server and cleanup resources.
   */
  dispose(): Promise<void>;
}
