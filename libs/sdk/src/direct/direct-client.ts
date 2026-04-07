/**
 * Direct Client Implementation
 *
 * Connects to a FrontMCP server as an MCP client with LLM-aware response formatting.
 */

import type {
  ServerCapabilities,
  Implementation,
  ListResourcesResult,
  ReadResourceResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  GetPromptResult,
  CompleteResult,
} from '@frontmcp/protocol';
import type {
  DirectClient,
  ConnectOptions,
  ClientInfo,
  LLMPlatform,
  SearchSkillsOptions,
  SearchSkillsResult,
  LoadSkillsOptions,
  LoadSkillsResult,
  ListSkillsOptions,
  ListSkillsResult,
  ElicitationHandler,
  ElicitationRequest,
  ElicitationResponse,
  CompleteOptions,
  McpLogLevel,
  ListJobsOptions,
  ListJobsResult,
  ExecuteJobOptions,
  JobExecutionResult,
  JobStatusResult,
  ListWorkflowsOptions,
  ListWorkflowsResult,
  ExecuteWorkflowOptions,
  WorkflowExecutionResult,
  WorkflowStatusResult,
  SkillAssetManifest,
  SkillAssetEntry,
} from './client.types';
import {
  detectPlatform,
  formatToolsForPlatform,
  formatResultForPlatform,
  type FormattedTools,
  type FormattedToolResult,
} from './llm-platform';
import type { Scope } from '../scope/scope.instance';
import { PublicMcpError } from '../errors';
import { randomUUID, pathResolve, fileExists } from '@frontmcp/utils';
import { Client } from '@frontmcp/protocol';
import {
  SkillsSearchResultSchema,
  SkillsLoadResultSchema,
  SkillsListResultSchema,
} from '../transport/mcp-handlers/skills-mcp.types';
/**
 * DirectClient implementation that wraps an MCP client.
 *
 * Provides:
 * - Standard MCP operations (listTools, callTool, etc.)
 * - LLM-aware tool/result formatting based on detected platform
 * - Session and auth token management
 *
 * @internal Use `connect()` or LLM-specific helpers to create instances.
 */
export class DirectClientImpl implements DirectClient {
  // Use a flexible type to handle dynamic import type differences between ESM/CJS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly mcpClient: any;
  private readonly sessionId: string;
  private readonly clientInfo: ClientInfo;
  private readonly platform: LLMPlatform;
  private readonly serverInfo: Implementation;
  private readonly capabilities: ServerCapabilities;
  private closeServer?: () => Promise<void>;

  // Elicitation handlers
  private elicitationHandler?: ElicitationHandler;

  // Resource update handlers
  private resourceUpdateHandlers: Set<(uri: string) => void> = new Set();

  // Generic notification handlers
  private notificationHandlers: Set<(notification: { method: string; params?: unknown }) => void> = new Set();

  // Scope reference for build-time operations (collectSkillAssets)
  private scopeRef?: Scope;

  private constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpClient: any,
    sessionId: string,
    clientInfo: ClientInfo,
    serverInfo: Implementation,
    capabilities: ServerCapabilities,
  ) {
    this.mcpClient = mcpClient;
    this.sessionId = sessionId;
    this.clientInfo = clientInfo;
    this.platform = detectPlatform(clientInfo);
    this.serverInfo = serverInfo;
    this.capabilities = capabilities;
  }

  /**
   * Create a DirectClient connected to the given scope.
   *
   * @param scope - FrontMCP scope to connect to
   * @param options - Connection options
   * @returns Connected DirectClient instance
   *
   * @internal Use `connect()` or LLM-specific helpers instead.
   */
  static async create(scope: Scope, options?: ConnectOptions): Promise<DirectClient> {
    // Dynamic imports for tree-shaking
    const { createInMemoryServer } = await import('../transport/in-memory-server.js');

    const sessionId = options?.session?.id ?? `direct:${randomUUID()}`;
    const clientInfo = options?.clientInfo ?? { name: 'mcp-client', version: '1.0.0' };

    // Build auth info from options
    const authInfo: Record<string, unknown> = {};
    if (options?.authToken) {
      authInfo['token'] = options.authToken;
    }
    if (options?.session?.user) {
      authInfo['user'] = {
        iss: 'direct',
        ...options.session.user,
        sub: options.session.user?.sub ?? 'direct',
      };
    }

    // Create in-memory server with auth context
    const { clientTransport, close } = await createInMemoryServer(scope, {
      sessionId,
      authInfo: Object.keys(authInfo).length > 0 ? authInfo : undefined,
    });

    try {
      // Build client capabilities
      const clientCapabilities = options?.capabilities
        ? {
            capabilities: options.capabilities,
          }
        : undefined;

      // Connect MCP client
      // Note: Using 'any' cast for clientTransport to handle ESM/CJS type incompatibility
      // between dynamic imports from @frontmcp/protocol
      const mcpClient = new Client(clientInfo, clientCapabilities);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await mcpClient.connect(clientTransport as any);

      // Get server info from handshake
      const serverInfo = mcpClient.getServerVersion();
      const serverCapabilities = mcpClient.getServerCapabilities();

      if (!serverInfo) {
        throw new PublicMcpError('Failed to get server info from MCP handshake', 'HANDSHAKE_FAILED', 500);
      }
      if (!serverCapabilities) {
        throw new PublicMcpError('Failed to get server capabilities from MCP handshake', 'HANDSHAKE_FAILED', 500);
      }

      const client = new DirectClientImpl(mcpClient, sessionId, clientInfo, serverInfo, serverCapabilities);
      client.closeServer = close;
      client.scopeRef = scope;

      // Set up internal handlers for notifications and requests
      // Note: MCP SDK uses typed notification/request handlers with zod schemas
      await client.setupNotificationHandlers(mcpClient);

      return client;
    } catch (error) {
      // Ensure server cleanup on any error during client setup
      await close();
      throw error;
    }
  }

  /**
   * Set up notification handlers for resource updates and elicitation.
   *
   * Uses MCP SDK's typed notification/request handlers:
   * - `ResourceUpdatedNotificationSchema` for resource update notifications
   * - `ElicitRequestSchema` for elicitation requests (server-to-client request, not notification)
   *
   * Wrapped in try-catch to gracefully handle SDK version differences.
   * @internal
   */
  private async setupNotificationHandlers(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpClient: any,
  ): Promise<void> {
    try {
      // Dynamic import to handle ESM/CJS compatibility
      const { ResourceUpdatedNotificationSchema, ElicitRequestSchema } = await import('@frontmcp/protocol');

      // Handler for resource updated notifications
      if (typeof mcpClient.setNotificationHandler === 'function') {
        mcpClient.setNotificationHandler(
          ResourceUpdatedNotificationSchema,
          (notification: { method?: string; params?: { uri?: string } }) => {
            const uri = notification.params?.uri;
            if (uri) {
              this.resourceUpdateHandlers.forEach((h) => h(uri));
            }
            // Also forward to generic notification handlers
            this.notificationHandlers.forEach((h) =>
              h({
                method: notification.method ?? 'notifications/resources/updated',
                params: notification.params,
              }),
            );
          },
        );
      }

      // Fallback handler for generic notifications (used by onNotification)
      if (typeof mcpClient.setNotificationHandler === 'function') {
        mcpClient.fallbackNotificationHandler = (notification: { method: string; params?: unknown }) => {
          this.notificationHandlers.forEach((h) => h(notification));
        };
      }

      // Handler for elicitation requests (server-to-client request, not notification)
      // The client responds with an ElicitResult
      if (typeof mcpClient.setRequestHandler === 'function') {
        mcpClient.setRequestHandler(ElicitRequestSchema, async (request: { params?: ElicitationRequest }) => {
          const params = request.params;
          if (params) {
            return this.handleElicitationRequestInternal(params);
          }
          return { action: 'decline' };
        });
      }
    } catch {
      // SDK version may not support these schemas - handlers are optional
      // Fall back to no-op; subscriptions will still work via explicit calls
    }
  }

  /**
   * Handle an incoming elicitation request and return the result.
   * Used by `setRequestHandler` which expects a return value.
   * @internal
   */
  private async handleElicitationRequestInternal(params: ElicitationRequest): Promise<ElicitationResponse> {
    if (this.elicitationHandler) {
      try {
        return await this.elicitationHandler(params);
      } catch {
        // If handler throws, decline the elicitation
        return { action: 'decline' };
      }
    }
    // Auto-decline if no handler registered
    return { action: 'decline' };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Operations (platform-formatted)
  // ─────────────────────────────────────────────────────────────────────────────

  async listTools(): Promise<FormattedTools> {
    const result = await this.mcpClient.listTools();
    return formatToolsForPlatform(result.tools, this.platform);
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<FormattedToolResult> {
    const result = await this.mcpClient.callTool({
      name,
      arguments: args ?? {},
    });
    // The result type may vary depending on MCP SDK version
    // formatResultForPlatform handles both content-based and toolResult-based responses
    return formatResultForPlatform(result, this.platform);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Resource Operations (raw format)
  // ─────────────────────────────────────────────────────────────────────────────

  async listResources(): Promise<ListResourcesResult> {
    return this.mcpClient.listResources();
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    return this.mcpClient.readResource({ uri });
  }

  async listResourceTemplates(): Promise<ListResourceTemplatesResult> {
    return this.mcpClient.listResourceTemplates();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Prompt Operations (raw format)
  // ─────────────────────────────────────────────────────────────────────────────

  async listPrompts(): Promise<ListPromptsResult> {
    return this.mcpClient.listPrompts();
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    return this.mcpClient.getPrompt({
      name,
      arguments: args,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Info
  // ─────────────────────────────────────────────────────────────────────────────

  getSessionId(): string {
    return this.sessionId;
  }

  getClientInfo(): ClientInfo {
    return this.clientInfo;
  }

  getServerInfo(): Implementation {
    return this.serverInfo;
  }

  getCapabilities(): ServerCapabilities {
    return this.capabilities;
  }

  getDetectedPlatform(): LLMPlatform {
    return this.platform;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    try {
      await this.mcpClient.close();
    } finally {
      // Ensure server cleanup runs even if mcpClient.close() throws
      await this.closeServer?.();
      // Dispose scope to clean up providers, timers, and native resources.
      // Prevents mutex crashes from addons (ONNX runtime, etc.) during process exit.
      if (this.scopeRef) {
        try {
          await this.scopeRef.dispose();
        } catch {
          /* best-effort */
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Skills Operations
  //
  // NOTE: Skills methods use `{} as any` for the response schema parameter because:
  // 1. Skills are FrontMCP-specific extensions, not part of the MCP protocol
  // 2. The server performs full schema validation using SkillsSearchResultSchema,
  //    SkillsLoadResultSchema, and SkillsListResultSchema
  // 3. The MCP SDK's client.request() validates responses using these schemas
  // 4. Schemas are shared between client and server
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Search for skills matching a query.
   *
   * @param query - Search query string
   * @param options - Optional search parameters (tags, tools, limit, requireAllTools)
   * @returns Search results with matching skills
   *
   * @remarks
   * Response is validated using `SkillsSearchResultSchema`.
   */
  async searchSkills(query: string, options?: SearchSkillsOptions): Promise<SearchSkillsResult> {
    return this.mcpClient.request(
      {
        method: 'skills/search',
        params: {
          query,
          ...options,
        },
      },
      SkillsSearchResultSchema,
    );
  }

  /**
   * Load skills by their IDs with full content.
   *
   * @param skillIds - Array of skill IDs to load
   * @param options - Optional load parameters (format, activateSession, policyMode)
   * @returns Loaded skills with instructions, tools, and metadata
   *
   * @remarks
   * Response is validated using `SkillsLoadResultSchema`.
   */
  async loadSkills(skillIds: string[], options?: LoadSkillsOptions): Promise<LoadSkillsResult> {
    return this.mcpClient.request(
      {
        method: 'skills/load',
        params: {
          skillIds,
          ...options,
        },
      },
      SkillsLoadResultSchema,
    );
  }

  /**
   * List available skills with optional filtering and pagination.
   *
   * @param options - Optional list parameters (offset, limit, tags, sortBy, sortOrder)
   * @returns Paginated list of skills
   *
   * @remarks
   * Response is validated using `SkillsListResultSchema`.
   */
  async listSkills(options?: ListSkillsOptions): Promise<ListSkillsResult> {
    return this.mcpClient.request(
      {
        method: 'skills/list',
        params: options ?? {},
      },
      SkillsListResultSchema,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Elicitation Operations
  // ─────────────────────────────────────────────────────────────────────────────

  onElicitation(handler: ElicitationHandler): () => void {
    this.elicitationHandler = handler;
    return () => {
      this.elicitationHandler = undefined;
    };
  }

  async submitElicitationResult(elicitId: string, response: ElicitationResponse): Promise<void> {
    await this.mcpClient.request(
      {
        method: 'elicitation/result',
        params: {
          elicitId,
          result: response,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any, // Schema validation happens server-side
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Completion Operations
  // ─────────────────────────────────────────────────────────────────────────────

  async complete(options: CompleteOptions): Promise<CompleteResult> {
    return this.mcpClient.complete(options);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Resource Subscription Operations
  // ─────────────────────────────────────────────────────────────────────────────

  async subscribeResource(uri: string): Promise<void> {
    await this.mcpClient.subscribeResource({ uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    await this.mcpClient.unsubscribeResource({ uri });
  }

  onResourceUpdated(handler: (uri: string) => void): () => void {
    this.resourceUpdateHandlers.add(handler);
    return () => {
      this.resourceUpdateHandlers.delete(handler);
    };
  }

  onNotification(handler: (notification: { method: string; params?: unknown }) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Logging Operations
  // ─────────────────────────────────────────────────────────────────────────────

  async setLogLevel(level: McpLogLevel): Promise<void> {
    await this.mcpClient.setLoggingLevel({ level });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Operations (via MCP tools)
  // ─────────────────────────────────────────────────────────────────────────────

  private async callToolAndParseJson<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.mcpClient.callTool({ name: toolName, arguments: args });
    const textContent = result.content?.find((c: { type: string }) => c.type === 'text');
    if (!textContent?.text) {
      throw new PublicMcpError(`No text content from ${toolName}`, 'EMPTY_RESPONSE', 500);
    }
    return JSON.parse(textContent.text) as T;
  }

  async listJobs(options?: ListJobsOptions): Promise<ListJobsResult> {
    return this.callToolAndParseJson('list-jobs', { ...options });
  }

  async executeJob(
    name: string,
    input?: Record<string, unknown>,
    options?: ExecuteJobOptions,
  ): Promise<JobExecutionResult> {
    return this.callToolAndParseJson('execute-job', {
      name,
      input: input ?? {},
      background: options?.background ?? false,
    });
  }

  async getJobStatus(runId: string): Promise<JobStatusResult> {
    return this.callToolAndParseJson('get-job-status', { runId });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Workflow Operations (via MCP tools)
  // ─────────────────────────────────────────────────────────────────────────────

  async listWorkflows(options?: ListWorkflowsOptions): Promise<ListWorkflowsResult> {
    return this.callToolAndParseJson('list-workflows', { ...options });
  }

  async executeWorkflow(
    name: string,
    input?: Record<string, unknown>,
    options?: ExecuteWorkflowOptions,
  ): Promise<WorkflowExecutionResult> {
    return this.callToolAndParseJson('execute-workflow', {
      name,
      input: input ?? {},
      background: options?.background ?? false,
    });
  }

  async getWorkflowStatus(runId: string): Promise<WorkflowStatusResult> {
    return this.callToolAndParseJson('get-workflow-status', { runId });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Build-Time Asset Collection
  // ─────────────────────────────────────────────────────────────────────────────

  async collectSkillAssets(): Promise<SkillAssetManifest> {
    const scope = this.scopeRef;
    if (!scope?.skills) return { entries: [] };

    const skills = scope.skills.getSkills({ includeHidden: true });
    const entries: SkillAssetEntry[] = [];

    for (const skill of skills) {
      const baseDir = (skill as { getBaseDir?: () => string | undefined }).getBaseDir?.();
      const meta = skill.metadata;

      const entry: SkillAssetEntry = {
        skillName: meta.name,
        baseDir,
      };

      // Collect instruction file path if file-based
      if (meta.instructions && typeof meta.instructions === 'object' && 'file' in meta.instructions) {
        const filePath = (meta.instructions as { file: string }).file;
        const resolved = filePath.startsWith('/') ? filePath : baseDir ? pathResolve(baseDir, filePath) : undefined;

        // In bundled environments, baseDir may resolve incorrectly (e.g., to the SDK dist).
        // If the resolved path doesn't exist, try resolving from cwd (the project root during build).
        if (resolved && (await fileExists(resolved))) {
          entry.instructionFile = resolved;
        } else if (!filePath.startsWith('/')) {
          // Search from project root using a glob-like walk for the relative path
          const fromCwd = findFileFromRoot(process.cwd(), filePath);
          if (fromCwd) {
            entry.instructionFile = fromCwd.absolute;
            entry.baseDir = fromCwd.baseDir;
          }
        }
      }

      // Collect resource directory paths
      const resources = skill.getResources?.();
      if (resources) {
        entry.resources = {};
        for (const key of ['references', 'examples', 'scripts', 'assets'] as const) {
          const p = resources[key];
          if (p) {
            const base = entry.baseDir || baseDir;
            const resolved = p.startsWith('/') ? p : base ? pathResolve(base, p) : undefined;
            if (resolved && (await fileExists(resolved))) {
              entry.resources[key] = resolved;
            }
          }
        }
      }

      entries.push(entry);
    }

    return { entries };
  }
}

/**
 * Search for a relative file path (e.g., './docs/foo.md') starting from a root directory.
 * Walks src/ subdirectories to find the file when baseDir from stack-walking is incorrect
 * in bundled environments.
 */
function findFileFromRoot(root: string, relativePath: string): { absolute: string; baseDir: string } | undefined {
  const fs = require('fs');
  const path = require('path');

  // Strip leading ./ from relative path
  const cleanRelative = relativePath.replace(/^\.\//, '');

  // Try common source directories
  const searchDirs = ['src', '.'];
  for (const srcDir of searchDirs) {
    const srcRoot = path.join(root, srcDir);
    if (!fs.existsSync(srcRoot)) continue;

    // Walk recursively looking for the file
    const found = walkForFile(srcRoot, cleanRelative, fs, path);
    if (found) return found;
  }
  return undefined;
}

function walkForFile(
  dir: string,
  targetRelative: string,
  fs: typeof import('fs'),
  path: typeof import('path'),
  maxDepth = 10,
): { absolute: string; baseDir: string } | undefined {
  // Check if targetRelative exists relative to this dir
  const candidate = path.join(dir, targetRelative);
  if (fs.existsSync(candidate)) {
    return { absolute: candidate, baseDir: dir };
  }

  if (maxDepth <= 0) return undefined;

  // Recurse into subdirectories
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules' &&
        entry.name !== 'dist'
      ) {
        const result = walkForFile(path.join(dir, entry.name), targetRelative, fs, path, maxDepth - 1);
        if (result) return result;
      }
    }
  } catch {
    // Ignore read errors
  }
  return undefined;
}
