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
} from '@modelcontextprotocol/sdk/types.js';
import type { DirectClient, ConnectOptions, ClientInfo, LLMPlatform } from './client.types';
import { detectPlatform, formatToolsForPlatform, formatResultForPlatform } from './llm-platform';
import type { Scope } from '../scope/scope.instance';

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
      throw new Error('Failed to get server info from MCP handshake');
    }
    if (!serverCapabilities) {
      throw new Error('Failed to get server capabilities from MCP handshake');
    }

    const client = new DirectClientImpl(mcpClient, sessionId, clientInfo, serverInfo, serverCapabilities);
    client.closeServer = close;
    return client;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Operations (platform-formatted)
  // ─────────────────────────────────────────────────────────────────────────────

  async listTools(): Promise<unknown> {
    const result = await this.mcpClient.listTools();
    return formatToolsForPlatform(result.tools, this.platform);
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<unknown> {
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
    await this.mcpClient.close();
    await this.closeServer?.();
  }
}
