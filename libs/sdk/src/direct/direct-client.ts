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
} from '@modelcontextprotocol/sdk/types.js';
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
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { createInMemoryServer } = await import('../transport/in-memory-server.js');
    const { randomUUID } = await import('@frontmcp/utils');

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
        sub: options.session.user.sub ?? 'direct',
        ...options.session.user,
      };
    }

    // Create in-memory server with auth context
    const { clientTransport, close } = await createInMemoryServer(scope, {
      sessionId,
      authInfo: Object.keys(authInfo).length > 0 ? authInfo : undefined,
    });

    // Build client capabilities
    const clientCapabilities = options?.capabilities
      ? {
          capabilities: options.capabilities,
        }
      : undefined;

    // Connect MCP client
    // Note: Using 'any' cast for clientTransport to handle ESM/CJS type incompatibility
    // between dynamic imports from @modelcontextprotocol/sdk
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

    // Set up internal handlers for notifications
    // Note: MCP SDK uses typed notification handlers; we set up generic handlers here
    client.setupNotificationHandlers(mcpClient);

    return client;
  }

  /**
   * Set up notification handlers for resource updates and elicitation.
   * Uses MCP SDK's setNotificationHandler for typed notification handling.
   * @internal
   */
  private setupNotificationHandlers(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpClient: any,
  ): void {
    // Handle resource update notifications using setNotificationHandler
    if (typeof mcpClient.setNotificationHandler === 'function') {
      // Handler for resource updated notifications
      mcpClient.setNotificationHandler(
        { method: 'notifications/resources/updated' },
        (notification: { params?: { uri?: string } }) => {
          const uri = notification.params?.uri;
          if (uri) {
            this.resourceUpdateHandlers.forEach((h) => h(uri));
          }
        },
      );

      // Handler for elicitation request notifications
      mcpClient.setNotificationHandler(
        { method: 'elicitation/request' },
        (notification: { params?: ElicitationRequest }) => {
          const params = notification.params;
          if (params) {
            this.handleElicitationRequest(params);
          }
        },
      );
    }
  }

  /**
   * Handle an incoming elicitation request.
   * @internal
   */
  private async handleElicitationRequest(params: ElicitationRequest): Promise<void> {
    if (this.elicitationHandler) {
      try {
        const response = await this.elicitationHandler(params);
        await this.submitElicitationResult(params.elicitId, response);
      } catch {
        // If handler throws, decline the elicitation
        await this.submitElicitationResult(params.elicitId, { action: 'decline' });
      }
    } else {
      // Auto-decline if no handler registered
      await this.submitElicitationResult(params.elicitId, { action: 'decline' });
    }
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
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Skills Operations
  // ─────────────────────────────────────────────────────────────────────────────

  async searchSkills(query: string, options?: SearchSkillsOptions): Promise<SearchSkillsResult> {
    return this.mcpClient.request(
      {
        method: 'skills/search',
        params: {
          query,
          ...options,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any, // Schema validation happens server-side
    );
  }

  async loadSkills(skillIds: string[], options?: LoadSkillsOptions): Promise<LoadSkillsResult> {
    return this.mcpClient.request(
      {
        method: 'skills/load',
        params: {
          skillIds,
          ...options,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any, // Schema validation happens server-side
    );
  }

  async listSkills(options?: ListSkillsOptions): Promise<ListSkillsResult> {
    return this.mcpClient.request(
      {
        method: 'skills/list',
        params: options ?? {},
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any, // Schema validation happens server-side
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Logging Operations
  // ─────────────────────────────────────────────────────────────────────────────

  async setLogLevel(level: McpLogLevel): Promise<void> {
    await this.mcpClient.setLoggingLevel({ level });
  }
}
