/**
 * Direct MCP Server - Types and Interfaces
 *
 * Provides programmatic access to FrontMCP servers without HTTP/stdio transports.
 * Useful for embedding MCP servers in existing applications, testing, and agent backends.
 */

import type {
  CallToolResult,
  GetPromptResult,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  ReadResourceResult,
} from '@frontmcp/protocol';
import type { EntryAvailability } from '@frontmcp/utils';

import type { ToolAnnotations } from '../common/metadata/tool.metadata';
import type { ConnectOptions, DirectClient } from './client.types';

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
 * Options for the list methods (`listTools`, `listResources`, `listResourceTemplates`, `listPrompts`).
 *
 * A FrontMCP server pages `tools/list` (40 tools per page by default). By default a list method
 * reads every page and returns the whole list, without `nextCursor`, as `DirectClient` does. To
 * page through the list yourself, as an MCP client does, set `paginate` (or pass a `cursor`).
 */
export interface DirectListOptions extends DirectCallOptions {
  /**
   * Return one page: the first, or the one `cursor` points at. The result carries `nextCursor`
   * while more pages remain; pass it back as `cursor` for the next page.
   * @default false
   */
  paginate?: boolean;
  /** The page to return: a previous page's `nextCursor`. A cursor implies `paginate`. */
  cursor?: string;
}

/**
 * What a runtime tool's `execute` receives besides its arguments.
 */
export interface RuntimeToolExecuteContext {
  /** Aborted when the call is cancelled or times out. */
  signal: AbortSignal;
}

/**
 * A tool defined at runtime by code outside the server, such as a React component, and added with
 * {@link DirectMcpServer.registerTool}. It becomes a regular tool of the server: listed by
 * `tools/list`, called through the `tools:call-tool` flow (hooks, authorities, quota and
 * `availableWhen` apply), and announced with `notifications/tools/list_changed`.
 */
export interface RuntimeToolDefinition {
  /** Tool name: 1-64 characters, unique in the server. */
  name: string;
  /** Human-readable title. */
  title?: string;
  /** What the tool does, for the model choosing it. */
  description?: string;
  /**
   * JSON Schema of the arguments, as listed by `tools/list`. The server does not validate arguments
   * against it: `execute` receives them as sent, so validate there.
   */
  inputSchema?: Record<string, unknown>;
  /** MCP behavioral hints (`readOnlyHint`, `destructiveHint`, ...). */
  annotations?: ToolAnnotations;
  /** Where the tool is offered, e.g. `{ surface: ['webmcp'] }` for in-browser agents only. */
  availableWhen?: EntryAvailability;
  /**
   * Id of the app the tool joins; its plugins' hooks apply to the tool. Optional when the server has
   * a single local app, as a `create()` server does.
   */
  app?: string;
  /**
   * Run the tool. The server waits for it without holding its request turn, so it may call the
   * server (or take long) without blocking other requests.
   */
  execute(args: Record<string, unknown>, context: RuntimeToolExecuteContext): Promise<CallToolResult> | CallToolResult;
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
   * List all available tools: every page, unless `options.paginate` or `options.cursor` asks for one.
   *
   * @param options - Optional call options with auth context, and paging
   * @returns List of tool definitions
   */
  listTools(options?: DirectListOptions): Promise<ListToolsResult>;

  /**
   * Call a tool with arguments.
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @param options - Optional call options with auth context
   * @returns Tool execution result
   */
  callTool(name: string, args?: Record<string, unknown>, options?: DirectCallOptions): Promise<CallToolResult>;

  /**
   * Add a tool to the running server. It is listed and called like any other tool, through the
   * server's flows, and connected clients get `notifications/tools/list_changed`.
   *
   * @param definition - The tool's name, schema and `execute` function
   * @returns A function that removes the tool again
   * @throws ToolNameConflictError if a tool with that name is already registered
   * @throws EntryValidationError if the name is empty or longer than 64 characters, or the app to
   *   join is unknown (or ambiguous: a server with several apps needs `definition.app`)
   *
   * @example
   * ```typescript
   * const unregister = await server.registerTool({
   *   name: 'get_cart',
   *   description: 'Items in the shopping cart',
   *   inputSchema: { type: 'object', properties: {} },
   *   execute: () => ({ content: [{ type: 'text', text: JSON.stringify(cart.items) }] }),
   * });
   * // later
   * unregister();
   * ```
   */
  registerTool(definition: RuntimeToolDefinition): Promise<() => void>;

  // ─────────────────────────────────────────────────────────────────
  // Resource Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all available resources: every page, unless `options.paginate` or `options.cursor` asks for one.
   *
   * @param options - Optional call options with auth context, and paging
   * @returns List of resource definitions
   */
  listResources(options?: DirectListOptions): Promise<ListResourcesResult>;

  /**
   * List all available resource templates: every page, unless `options.paginate` or `options.cursor`
   * asks for one.
   *
   * @param options - Optional call options with auth context, and paging
   * @returns List of resource template definitions
   */
  listResourceTemplates(options?: DirectListOptions): Promise<ListResourceTemplatesResult>;

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
   * List all available prompts: every page, unless `options.paginate` or `options.cursor` asks for one.
   *
   * @param options - Optional call options with auth context, and paging
   * @returns List of prompt definitions
   */
  listPrompts(options?: DirectListOptions): Promise<ListPromptsResult>;

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
  // Job Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all available jobs.
   *
   * @param options - Optional call options with auth context
   * @returns Tool call result containing jobs list as JSON text
   */
  listJobs(options?: DirectCallOptions): Promise<CallToolResult>;

  /**
   * Execute a job by name.
   *
   * @param name - Job name
   * @param input - Job input arguments
   * @param options - Optional call options with auth context and background flag
   * @returns Tool call result containing execution result as JSON text
   */
  executeJob(
    name: string,
    input?: Record<string, unknown>,
    options?: DirectCallOptions & { background?: boolean },
  ): Promise<CallToolResult>;

  /**
   * Get the status of a job run.
   *
   * @param runId - The run ID returned from executeJob
   * @param options - Optional call options with auth context
   * @returns Tool call result containing job status as JSON text
   */
  getJobStatus(runId: string, options?: DirectCallOptions): Promise<CallToolResult>;

  // ─────────────────────────────────────────────────────────────────
  // Workflow Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all available workflows.
   *
   * @param options - Optional call options with auth context
   * @returns Tool call result containing workflows list as JSON text
   */
  listWorkflows(options?: DirectCallOptions): Promise<CallToolResult>;

  /**
   * Execute a workflow by name.
   *
   * @param name - Workflow name
   * @param input - Workflow input arguments
   * @param options - Optional call options with auth context and background flag
   * @returns Tool call result containing execution result as JSON text
   */
  executeWorkflow(
    name: string,
    input?: Record<string, unknown>,
    options?: DirectCallOptions & { background?: boolean },
  ): Promise<CallToolResult>;

  /**
   * Get the status of a workflow run.
   *
   * @param runId - The run ID returned from executeWorkflow
   * @param options - Optional call options with auth context
   * @returns Tool call result containing workflow status as JSON text
   */
  getWorkflowStatus(runId: string, options?: DirectCallOptions): Promise<CallToolResult>;

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
