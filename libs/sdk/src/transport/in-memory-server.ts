/**
 * In-Memory MCP Server Factory
 *
 * Creates an in-memory FrontMCP server that can be consumed by MCP SDK Client.
 * Useful for testing, embedding in applications, and LangChain integration.
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Scope } from '../scope/scope.instance';
import { randomUUID } from '@frontmcp/utils';

/**
 * Options for creating an in-memory MCP server.
 */
export interface CreateInMemoryServerOptions {
  /** Auth info to inject on all client requests */
  authInfo?: Partial<AuthInfo>;
  /** Custom session ID (auto-generated if not provided) */
  sessionId?: string;
}

/**
 * Result from creating an in-memory server.
 */
export interface InMemoryServerResult {
  /** Transport to pass to MCP Client.connect() */
  clientTransport: Transport;
  /** Set auth info for subsequent requests */
  setAuthInfo: (authInfo: Partial<AuthInfo>) => void;
  /** Disconnect the in-memory server */
  close: () => Promise<void>;
}

/**
 * Create an in-memory FrontMCP server that can be consumed by MCP SDK Client.
 *
 * This is useful for:
 * - Testing MCP tools, resources, and prompts
 * - Embedding FrontMCP in other applications
 * - Integration with LangChain MCP adapters
 * - Avoiding HTTP overhead in single-process scenarios
 *
 * @example
 * ```typescript
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * import { FrontMcpInstance, createInMemoryServer } from '@frontmcp/sdk';
 *
 * // Create a FrontMCP instance
 * const frontMcp = await FrontMcpInstance.createForGraph(config);
 * const scope = frontMcp.getScopes()[0];
 *
 * // Create in-memory server
 * const { clientTransport, setAuthInfo, close } = await createInMemoryServer(scope, {
 *   authInfo: { token: 'test-token', user: { sub: 'user-123' } }
 * });
 *
 * // Connect MCP client
 * const client = new Client({ name: 'test-client', version: '1.0.0' });
 * await client.connect(clientTransport);
 *
 * // Use the client
 * const tools = await client.listTools();
 * const result = await client.callTool({ name: 'my-tool', arguments: { foo: 'bar' } });
 *
 * // Change auth context
 * setAuthInfo({ token: 'new-token', user: { sub: 'other-user' } });
 *
 * // Cleanup
 * await close();
 * ```
 *
 * @example
 * ```typescript
 * // With LangChain MCP adapters
 * import { createInMemoryServer } from '@frontmcp/sdk';
 *
 * const { clientTransport, setAuthInfo } = await createInMemoryServer(scope);
 *
 * // LangChain's MCP adapter can use the transport directly
 * const client = new MultiServerMCPClient({
 *   servers: [{
 *     name: 'frontmcp',
 *     transport: clientTransport,
 *   }]
 * });
 * ```
 */
export async function createInMemoryServer(
  scope: Scope,
  options?: CreateInMemoryServerOptions,
): Promise<InMemoryServerResult> {
  // Dynamically import to avoid bundling issues
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { Server: McpServer } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { createMcpHandlers } = await import('./mcp-handlers/index.js');

  const sessionId = options?.sessionId ?? `in-memory:${randomUUID()}`;

  // Create linked transport pair
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Track current auth info (can be updated dynamically)
  let currentAuthInfo: Partial<AuthInfo> = options?.authInfo ?? {};

  // Check for remote apps
  const hasRemoteApps = scope.apps?.getApps().some((app) => app.isRemote) ?? false;

  // Build server options with capabilities
  const hasPrompts = scope.prompts.hasAny() || hasRemoteApps;
  const hasResources = scope.resources.hasAny() || hasRemoteApps;

  const completionsCapability = hasPrompts || hasResources ? { completions: {} } : {};
  const remoteCapabilities = hasRemoteApps
    ? {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
      }
    : {};

  const serverOptions = {
    instructions: '',
    capabilities: {
      ...remoteCapabilities,
      ...scope.tools.getCapabilities(),
      ...scope.resources.getCapabilities(),
      ...scope.prompts.getCapabilities(),
      ...scope.agents.getCapabilities(),
      ...completionsCapability,
      logging: {},
    },
    serverInfo: scope.metadata.info,
  };

  // Create MCP server
  const mcpServer = new McpServer(scope.metadata.info, serverOptions);

  // Register handlers with auth context injection
  const handlers = createMcpHandlers({ scope, serverOptions });
  for (const handler of handlers) {
    // Wrap handler to inject auth context
    const originalHandler = handler.handler;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrappedHandler = async (request: any, ctx: any) => {
      // Inject auth info into context while preserving MCP SDK context properties
      const enrichedCtx = {
        ...ctx,
        authInfo: {
          ...currentAuthInfo,
          sessionId,
        },
      };
      return originalHandler(request, enrichedCtx);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpServer.setRequestHandler(handler.requestSchema, wrappedHandler as any);
  }

  // Register server with notification service
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope.notifications.registerServer(sessionId, mcpServer as any);

  // Connect server to transport
  await mcpServer.connect(serverTransport);

  return {
    clientTransport,
    setAuthInfo: (authInfo: Partial<AuthInfo>) => {
      currentAuthInfo = authInfo;
    },
    close: async () => {
      scope.notifications.unregisterServer(sessionId);
      await mcpServer.close();
    },
  };
}
