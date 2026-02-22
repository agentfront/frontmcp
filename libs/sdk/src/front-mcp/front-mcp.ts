import {
  FrontMcpConfigInput,
  FrontMcpConfigType,
  FrontMcpInterface,
  FrontMcpLogger,
  FrontMcpServer,
  ScopeEntry,
  frontMcpMetadataSchema,
} from '../common';
import { ScopeRegistry } from '../scope/scope.registry';
import ProviderRegistry from '../provider/provider.registry';
import { createMcpGlobalProviders } from './front-mcp.providers';
import LoggerRegistry from '../logger/logger.registry';
import { DirectMcpServerImpl } from '../direct';
import type { DirectMcpServer } from '../direct';
import type { Scope } from '../scope/scope.instance';
import { InternalMcpError, ServerNotFoundError } from '../errors';
import { randomUUID, fileExists, unlink } from '@frontmcp/utils';
import type { SqliteOptionsInput } from '../common/types/options/sqlite/schema';

export class FrontMcpInstance implements FrontMcpInterface {
  config: FrontMcpConfigType;
  readonly ready: Promise<void>;

  private logger: LoggerRegistry;
  private providers: ProviderRegistry;
  private scopes: ScopeRegistry;
  private log?: FrontMcpLogger;

  constructor(config: FrontMcpConfigType) {
    this.config = config;
    this.ready = this.initialize();
  }

  async initialize(): Promise<void> {
    this.providers = new ProviderRegistry([...createMcpGlobalProviders(this.config)]);
    await this.providers.ready;

    this.logger = new LoggerRegistry(this.providers);
    await this.logger.ready;

    this.log = this.providers.get(FrontMcpLogger);
    const name = this.config.info?.name;
    const version = this.config.info?.version;
    const tag = [name, version].filter(Boolean).join(' v');
    this.log?.info(`Initializing FrontMCP${tag ? ` "${tag}"` : ''}...`);

    this.scopes = new ScopeRegistry(this.providers);
    await this.scopes.ready;
  }

  async start() {
    this.log?.info('Starting FrontMCP server...');
    const server = this.providers.get(FrontMcpServer);
    if (!server) {
      throw new ServerNotFoundError();
    }
    await server.start();
  }

  /**
   * Get the configuration used to create this FrontMCP instance.
   */
  getConfig(): FrontMcpConfigType {
    return this.config;
  }

  /**
   * Get all initialized scope instances.
   * Useful for graph visualization and introspection.
   */
  getScopes(): ScopeEntry[] {
    return this.scopes.getScopes();
  }

  public static async bootstrap(options: FrontMcpConfigType) {
    const frontMcp = new FrontMcpInstance(options);
    await frontMcp.ready;

    await frontMcp.start();
    frontMcp.log?.info('FrontMCP bootstrap complete');
  }

  /**
   * Creates and initializes a FrontMCP instance without starting the HTTP server.
   * Returns the underlying HTTP handler for serverless deployments (Vercel, Lambda).
   *
   * @example
   * // In index.ts for Vercel
   * import { FrontMcpInstance } from '@frontmcp/sdk';
   * import config from '../src/main';
   *
   * export default FrontMcpInstance.createHandler(config);
   */
  public static async createHandler(options: FrontMcpConfigType): Promise<unknown> {
    const frontMcp = new FrontMcpInstance(options);
    await frontMcp.ready;

    const server = frontMcp.providers.get(FrontMcpServer);
    if (!server) {
      throw new ServerNotFoundError();
    }

    server.prepare();
    frontMcp.log?.info('FrontMCP handler created (serverless mode)');
    return server.getHandler();
  }

  /**
   * Creates and initializes a FrontMCP instance without starting any server.
   * Returns the instance for graph extraction and introspection purposes.
   *
   * @example
   * // For graph visualization
   * const instance = await FrontMcpInstance.createForGraph(config);
   * const scopes = instance.getScopes();
   */
  public static async createForGraph(options: FrontMcpConfigInput): Promise<FrontMcpInstance> {
    // Parse config through Zod to apply defaults (providers, tools, etc.)
    const parsedConfig = frontMcpMetadataSchema.parse(options);
    const frontMcp = new FrontMcpInstance(parsedConfig);
    await frontMcp.ready;
    return frontMcp;
  }

  /**
   * Creates a DirectMcpServer from a FrontMCP configuration.
   * This provides direct programmatic access to MCP operations
   * without requiring HTTP transport.
   *
   * Use cases:
   * - Unit/integration testing tools, resources, prompts
   * - Embedding MCP capabilities in other applications
   * - CLI tools that need direct access
   * - Agent backends with custom invocation
   *
   * @example
   * ```typescript
   * import { FrontMcpInstance } from '@frontmcp/sdk';
   * import MyServer from './my-server';
   *
   * const server = await FrontMcpInstance.createDirect(MyServer);
   *
   * // List all tools
   * const tools = await server.listTools();
   *
   * // Call a tool with auth context
   * const result = await server.callTool('my-tool', { param: 'value' }, {
   *   authContext: { sessionId: 'user-123', token: 'jwt-token' }
   * });
   *
   * // Cleanup when done
   * await server.dispose();
   * ```
   */
  public static async createDirect(options: FrontMcpConfigInput): Promise<DirectMcpServer> {
    // Parse config through Zod to apply defaults, then disable HTTP server
    const parsedConfig = frontMcpMetadataSchema.parse({
      ...options,
      // Disable HTTP server since we're using direct access
      http: undefined,
    });
    const frontMcp = new FrontMcpInstance(parsedConfig);
    await frontMcp.ready;

    // Get the primary scope
    const scopes = frontMcp.getScopes();
    if (scopes.length === 0) {
      throw new InternalMcpError('No scopes initialized. Ensure at least one app is configured.');
    }

    // Return a DirectMcpServer wrapping the first scope
    frontMcp.log?.info('FrontMCP direct server created');
    return new DirectMcpServerImpl(scopes[0] as Scope);
  }

  /**
   * Runs the FrontMCP server using stdio transport for use with Claude Code
   * or other MCP clients that support stdio communication.
   *
   * This method connects the server to stdin/stdout and handles MCP protocol
   * messages directly. It does not return until the connection is closed.
   *
   * @example
   * ```typescript
   * // In your CLI entrypoint
   * import { FrontMcpInstance } from '@frontmcp/sdk';
   * import MyServer from './my-server';
   *
   * FrontMcpInstance.runStdio(MyServer);
   * ```
   *
   * @example
   * ```bash
   * # In Claude Desktop config:
   * {
   *   "mcpServers": {
   *     "my-server": {
   *       "command": "node",
   *       "args": ["./dist/main.js", "--stdio"]
   *     }
   *   }
   * }
   * ```
   */
  /**
   * Runs the FrontMCP server on a Unix socket for local-only access.
   *
   * This enables a persistent background FrontMCP server accessible only via
   * a Unix `.sock` file. The entire HTTP feature set (streamable HTTP, SSE,
   * elicitation, sessions) works unchanged over Unix sockets.
   *
   * @example
   * ```typescript
   * import { FrontMcpInstance } from '@frontmcp/sdk';
   * import MyServer from './my-server';
   *
   * const handle = await FrontMcpInstance.runUnixSocket({
   *   ...MyServer,
   *   socketPath: '/tmp/my-app.sock',
   *   sqlite: { path: '~/.frontmcp/data/my-app.sqlite' },
   * });
   *
   * // Later: graceful shutdown
   * await handle.close();
   * ```
   */
  public static async runUnixSocket(
    options: FrontMcpConfigInput & {
      socketPath: string;
      sqlite?: SqliteOptionsInput;
    },
  ): Promise<{ close: () => Promise<void> }> {
    const { socketPath, sqlite, ...configInput } = options;

    // Parse config with HTTP enabled, overriding socketPath
    const parsedConfig = frontMcpMetadataSchema.parse({
      ...configInput,
      http: {
        ...((configInput.http as Record<string, unknown>) ?? {}),
        socketPath,
      },
      // Merge sqlite config if provided
      ...(sqlite ? { sqlite } : {}),
    });

    const frontMcp = new FrontMcpInstance(parsedConfig);
    await frontMcp.ready;

    await frontMcp.start();
    frontMcp.log?.info(`MCP server listening on unix://${socketPath}`);

    // Cleanup function to remove socket file and signal handlers
    const cleanup = async () => {
      try {
        if (await fileExists(socketPath)) {
          await unlink(socketPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    };

    // Register signal handlers for cleanup
    const signalHandler = async () => {
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
      await cleanup();
      process.exit(0);
    };
    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    // Return handle for programmatic shutdown
    const close = async () => {
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
      await cleanup();
    };

    return { close };
  }

  public static async runStdio(options: FrontMcpConfigInput): Promise<void> {
    // Dynamically import to avoid bundling issues
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { Server: McpServer } = await import('@modelcontextprotocol/sdk/server/index.js');

    // Parse config through Zod to apply defaults, then disable HTTP server
    const parsedConfig = frontMcpMetadataSchema.parse({
      ...options,
      http: undefined,
    });
    const frontMcp = new FrontMcpInstance(parsedConfig);
    await frontMcp.ready;

    // Get the primary scope
    const scopes = frontMcp.getScopes();
    if (scopes.length === 0) {
      throw new InternalMcpError('No scopes initialized. Ensure at least one app is configured.');
    }
    const scope = scopes[0] as Scope;

    // Import the MCP handlers creator
    const { createMcpHandlers } = await import('../transport/mcp-handlers/index.js');

    // Check for remote apps
    const hasRemoteApps = scope.apps?.getApps().some((app) => app.isRemote) ?? false;

    // Build server options with capabilities
    const hasTools = scope.tools.hasAny() || hasRemoteApps;
    const hasResources = scope.resources.hasAny() || hasRemoteApps;
    const hasPrompts = scope.prompts.hasAny() || hasRemoteApps;
    const hasAgents = scope.agents.hasAny();

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

    // Generate session ID for stdio connection
    const sessionId = `stdio:${randomUUID()}`;

    // Register handlers with auth context injection
    const handlers = createMcpHandlers({ scope, serverOptions });
    for (const handler of handlers) {
      // Wrap handler to inject auth context (same pattern as in-memory-server)
      const originalHandler = handler.handler;
      const wrappedHandler = async (request: unknown, ctx: Record<string, unknown>) => {
        // Inject auth info into context while preserving MCP SDK context properties
        // Merge with existing authInfo to avoid clobbering any existing properties
        const existingAuthInfo = ctx?.['authInfo'] as Record<string, unknown> | undefined;
        const enrichedCtx = {
          ...ctx,
          authInfo: { ...existingAuthInfo, sessionId },
        };
        // The cast is safe: request type matches handler.requestSchema
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return originalHandler(request as any, enrichedCtx as any);
      };
      // Cast required: MCP SDK's handler type expects specific context shape,
      // but our wrapped handlers preserve all context properties via pass-through
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpServer.setRequestHandler(handler.requestSchema, wrappedHandler as any);
    }

    // Create stdio transport and connect
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    // Handle graceful shutdown with error handling
    process.on('SIGINT', async () => {
      try {
        await mcpServer.close();
      } catch (err) {
        console.error('Error closing MCP server:', err);
      }
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      try {
        await mcpServer.close();
      } catch (err) {
        console.error('Error closing MCP server:', err);
      }
      process.exit(0);
    });
  }
}
