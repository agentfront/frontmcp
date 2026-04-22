import { fileExists, randomUUID, unlink } from '@frontmcp/utils';

import {
  FrontMcpLogger,
  frontMcpMetadataSchema,
  FrontMcpServer,
  parseFrontMcpConfigLite,
  type FrontMcpConfigInput,
  type FrontMcpConfigType,
  type FrontMcpInterface,
  type ScopeEntry,
} from '../common';
import { mergeCloudContributions } from '../common/types/options/cloud/merge';
import type { CloudProvider } from '../common/types/options/cloud/provider';
import { CloudRuntimeContextToken, InMemoryCloudRuntimeContext } from '../common/types/options/cloud/runtime-context';
import { type SqliteOptionsInput } from '../common/types/options/sqlite/schema';
import { DirectMcpServerImpl, type DirectMcpServer } from '../direct';
import { InternalMcpError, ServerNotFoundError } from '../errors';
import { HealthService } from '../health';
import { FileLogTransportInstance } from '../logger/instances/instance.file-logger';
import LoggerRegistry from '../logger/logger.registry';
import ProviderRegistry from '../provider/provider.registry';
import { loadCloudProvider } from '../scope/cloud-autoload';
import { type Scope } from '../scope/scope.instance';
import { ScopeRegistry } from '../scope/scope.registry';
import { type FrontMcpServerInstance } from '../server/server.instance';
import { computeTaskCapabilities } from '../task';
import { createMcpGlobalProviders } from './front-mcp.providers';

export class FrontMcpInstance implements FrontMcpInterface {
  config: FrontMcpConfigType;
  readonly ready: Promise<void>;

  private logger: LoggerRegistry;
  private providers: ProviderRegistry;
  private scopes: ScopeRegistry;
  private log?: FrontMcpLogger;
  private cloud?: { provider: CloudProvider; runtime: InMemoryCloudRuntimeContext };

  /**
   * @param config parsed + cloud-merged FrontMcpConfigType
   * @param cloud optional cloud binding; assigned BEFORE initialize() runs so
   *  its `if (this.cloud)` branch sees a deterministic value (no microtask
   *  race between constructor and assign-after-new).
   */
  constructor(config: FrontMcpConfigType, cloud?: { provider: CloudProvider; runtime: InMemoryCloudRuntimeContext }) {
    this.config = config;
    this.cloud = cloud;
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

    // Register the cloud runtime context as a global provider so tools/hooks
    // can `@Inject(CloudRuntimeContextToken)` to read cloud-published values
    // (login URL, feature flags, managed cors origins, etc.). The context is
    // only created when a cloud provider is attached; otherwise tools that
    // depend on it must handle `undefined`.
    if (this.cloud) {
      this.providers.addDynamicProviders([
        {
          name: 'cloud:runtime-context',
          provide: CloudRuntimeContextToken,
          useValue: this.cloud.runtime,
        },
      ]);
    }

    this.scopes = new ScopeRegistry(this.providers);
    await this.scopes.ready;

    // Async cloud bootstrap — runs AFTER the scope is ready. Cloud can now
    // fetch remote config over HTTP (using any DI providers its static
    // contributions registered earlier) and populate the runtime context.
    await this.runCloudBootstrap();
  }

  private async runCloudBootstrap(): Promise<void> {
    if (!this.cloud) return;
    const { provider, runtime } = this.cloud;
    // Typeof guard: a truthy non-function (e.g. `true`, string) would crash
    // on call; treat only an actual function as a valid bootstrap.
    if (typeof provider.bootstrap !== 'function') return;

    const cloudOptions = (this.config as unknown as { cloud?: unknown }).cloud;
    const logger = this.log?.child(`cloud:${provider.name}`);
    const bootstrapLogger = {
      info: (msg: string, meta?: Record<string, unknown>) => logger?.info(msg, meta),
      warn: (msg: string, meta?: Record<string, unknown>) => logger?.warn(msg, meta),
      debug: (msg: string, meta?: Record<string, unknown>) => logger?.verbose?.(msg, meta),
      error: (msg: string, meta?: Record<string, unknown>) => logger?.error?.(msg, meta),
    };

    try {
      await provider.bootstrap({
        options: cloudOptions as Parameters<NonNullable<CloudProvider['bootstrap']>>[0]['options'],
        runtime,
        logger: bootstrapLogger,
        registries: this.resolveCloudRegistries(),
      });
      this.log?.verbose?.(`cloud: provider '${provider.name}' bootstrap complete`);
    } catch (e) {
      // Publish a failure flag so tools/hooks that depend on cloud-managed
      // runtime values (login URL, feature flags, cors allowlist) can fail
      // fast instead of operating on stale/missing defaults.
      runtime.set('cloud.bootstrapFailed', true);
      runtime.set('cloud.bootstrapError', e instanceof Error ? e.message : String(e));
      this.log?.warn(`cloud: provider '${provider.name}' bootstrap failed`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Build the `registries` field passed to cloud bootstrap. Picks the primary
   * (first) scope — multi-scope aggregation is a future extension. Returns
   * `undefined` when no scopes exist (nothing to expose).
   */
  private resolveCloudRegistries():
    | NonNullable<Parameters<NonNullable<CloudProvider['bootstrap']>>[0]['registries']>
    | undefined {
    const scopes = this.getScopes() as Scope[];
    const primary = scopes[0];
    if (!primary) return undefined;
    return {
      tools: primary.tools,
      resources: primary.resources,
      prompts: primary.prompts,
      agents: primary.agents,
    };
  }

  async start() {
    this.log?.info('Starting FrontMCP server...');
    const server = this.providers.get(FrontMcpServer);
    if (!server) {
      throw new ServerNotFoundError();
    }

    // Wire health service from the first scope (if available)
    this.wireHealthService(server);

    await server.start();

    // Emit server-started lifecycle event to all scopes
    for (const scope of this.getScopes()) {
      await scope.emitServerStarted();
    }
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

  /**
   * Wire the health service from the first scope into the server instance.
   * Called before server.start() or server.prepare() to register health routes.
   */
  private wireHealthService(server: FrontMcpServer): void {
    const serverInstance = server as FrontMcpServerInstance;
    if (typeof serverInstance.setHealthService !== 'function') return;

    const healthConfig = this.config.health ?? {};
    const scopes = this.getScopes() as Scope[];

    // Collect health services from all scopes (split-by-app can produce multiple)
    const scopeServices = scopes.map((s) => s.healthService).filter((hs): hs is HealthService => hs !== undefined);

    if (scopeServices.length === 1) {
      serverInstance.setHealthService(scopeServices[0], healthConfig);
    } else if (scopeServices.length > 1) {
      // Aggregate: create a composite service that merges probes from all scopes
      const composite = new HealthService(healthConfig, this.config.info);
      for (const scopeService of scopeServices) {
        for (const probe of scopeService.getProbes()) {
          composite.registerProbe(probe);
        }
      }
      // Use first scope's catalog view (catalog is scope-level; probes are aggregated)
      const firstScope = scopes[0];
      if (firstScope) {
        composite.setScopeView(firstScope);
      }
      serverInstance.setHealthService(composite, healthConfig);
    } else {
      // No health service (disabled or CLI mode) — still pass config so
      // server.prepare() can check enabled=false and skip legacy fallback
      serverInstance.setHealthConfig(healthConfig);
    }
  }

  public static async bootstrap(options: FrontMcpConfigInput | FrontMcpConfigType) {
    const parsedConfig = frontMcpMetadataSchema.parse(options);

    // When FRONTMCP_DAEMON_SOCKET is set (e.g., SEA binary started as daemon),
    // run in Unix socket mode instead of normal HTTP server
    const daemonSocket = process.env['FRONTMCP_DAEMON_SOCKET'];
    if (daemonSocket) {
      await FrontMcpInstance.runUnixSocket({ ...parsedConfig, socketPath: daemonSocket });
      return;
    }

    const { config: mergedConfig, cloud } = FrontMcpInstance.applyCloudContributions(parsedConfig);
    const frontMcp = new FrontMcpInstance(mergedConfig, cloud);
    await frontMcp.ready;

    await frontMcp.start();
    frontMcp.log?.info('FrontMCP bootstrap complete');
  }

  /**
   * Resolve the configured cloud provider (if any), merge its synchronous
   * static contributions into the parsed config, and pair the provider with
   * a fresh runtime context. The returned `cloud` object is passed into
   * `new FrontMcpInstance(config, cloud)` so `initialize()` sees it
   * deterministically at the moment `this.cloud` is read.
   *
   * Post-merge steps:
   *   1. Re-run `applyAutoTransportPersistence` so cloud-injected `redis`
   *      still triggers transport session auto-persistence.
   *   2. Re-parse through `frontMcpMetadataSchema` so cloud-contributed
   *      `apps`, `plugins`, `providers`, etc. are Zod-validated the same
   *      as user-supplied entries.
   */
  private static applyCloudContributions(parsedConfig: FrontMcpConfigType): {
    config: FrontMcpConfigType;
    cloud?: { provider: CloudProvider; runtime: InMemoryCloudRuntimeContext };
  } {
    const cloudOptions = (parsedConfig as unknown as { cloud?: unknown }).cloud;
    // Bootstrap logger isn't available yet — write to stderr so a stdio MCP
    // server's stdout JSON-RPC stream is never corrupted.
    const preLogger = {
      warn: (msg: string) => {
        try {
          process.stderr.write(`[frontmcp] ${msg}\n`);
        } catch {
          // process may be undefined in edge runtimes — fall through silently.
        }
      },
      verbose: undefined,
    };
    const loaded = loadCloudProvider(cloudOptions, preLogger);
    if (!loaded) return { config: parsedConfig };

    const merged = mergeCloudContributions(parsedConfig as Record<string, unknown>, loaded.contributions, preLogger);

    // Re-validate post-merge so cloud-injected apps/providers/tools honor
    // the same schema as user-supplied ones. Skip the transform chain
    // because the input is already fully-resolved; we just want shape
    // validation + re-run of applyAutoTransportPersistence.
    let finalConfig: FrontMcpConfigType;
    try {
      finalConfig = frontMcpMetadataSchema.parse(merged) as FrontMcpConfigType;
    } catch (e) {
      preLogger.warn(
        `cloud: contributions failed re-validation — falling back to merged config without re-validation: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      finalConfig = merged as FrontMcpConfigType;
    }

    return {
      config: finalConfig,
      cloud: { provider: loaded.provider, runtime: new InMemoryCloudRuntimeContext() },
    };
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
    const { config, cloud } = FrontMcpInstance.applyCloudContributions(options);
    const frontMcp = new FrontMcpInstance(config, cloud);
    await frontMcp.ready;

    const server = frontMcp.providers.get(FrontMcpServer);
    if (!server) {
      throw new ServerNotFoundError();
    }

    // Wire health service for serverless mode
    frontMcp.wireHealthService(server);

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
    const { config, cloud } = FrontMcpInstance.applyCloudContributions(parsedConfig);
    const frontMcp = new FrontMcpInstance(config, cloud);
    await frontMcp.ready;
    return frontMcp;
  }

  /**
   * Creates a FrontMCP instance optimized for CLI execution.
   * Skips non-essential registries (UI widget compilation, event stores,
   * elicitation stores) for faster startup (~100-150ms savings).
   *
   * @example
   * const instance = await FrontMcpInstance.createForCli(config);
   * const scopes = instance.getScopes();
   */
  public static async createForCli(options: FrontMcpConfigInput): Promise<FrontMcpInstance> {
    const parsedConfig = parseFrontMcpConfigLite(options);
    // Mark config for CLI mode so Scope can skip non-essential work
    (parsedConfig as Record<string, unknown>)['__cliMode'] = true;

    // CLI logging: file transport always on, console only with --verbose.
    // Follows npm/pip pattern: full verbosity goes to ~/.frontmcp/logs/,
    // console stays clean unless explicitly requested.
    const verbose = process.env['FRONTMCP_CLI_VERBOSE'] === '1';
    if (parsedConfig.logging) {
      parsedConfig.logging.enableConsole = verbose;
      const transports = parsedConfig.logging.transports ?? [];
      if (!transports.includes(FileLogTransportInstance)) {
        transports.push(FileLogTransportInstance);
      }
      parsedConfig.logging.transports = transports;
    } else {
      (parsedConfig as Record<string, unknown>)['logging'] = {
        enableConsole: verbose,
        transports: [FileLogTransportInstance],
      };
    }

    // Load cloud provider in CLI mode too. The lite schema treats `cloud`
    // as opaque, so any fields populated by the full schema's defaults
    // (e.g. `domain`) are NOT filled in here — the cloud provider itself
    // must apply defaults. We still wire the runtime context and bootstrap.
    const { config: mergedConfig, cloud } = FrontMcpInstance.applyCloudContributions(
      parsedConfig as FrontMcpConfigType,
    );
    const frontMcp = new FrontMcpInstance(mergedConfig, cloud);
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
    options: (FrontMcpConfigInput | FrontMcpConfigType) & {
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
    // ── Stdio stdout protection ──────────────────────────────────────────
    // In stdio mode, stdout is the MCP JSON-RPC channel. ANY non-protocol
    // output (logs, warnings, debug prints) on stdout corrupts the wire.
    // Redirect all stdout-bound console methods to stderr BEFORE anything
    // else runs — this catches direct console.log() calls in SDK code,
    // plugins, adapters, and third-party dependencies.
    const { Console } = require('node:console');
    const stderrConsole = new Console({ stdout: process.stderr, stderr: process.stderr });
    console.log = stderrConsole.log.bind(stderrConsole);
    console.info = stderrConsole.info.bind(stderrConsole);
    console.debug = stderrConsole.debug.bind(stderrConsole);
    console.dir = stderrConsole.dir.bind(stderrConsole);
    console.table = stderrConsole.table.bind(stderrConsole);
    console.time = stderrConsole.time.bind(stderrConsole);
    console.timeLog = stderrConsole.timeLog.bind(stderrConsole);
    console.group = stderrConsole.group.bind(stderrConsole);
    console.groupEnd = stderrConsole.groupEnd.bind(stderrConsole);
    console.count = stderrConsole.count.bind(stderrConsole);
    // console.warn and console.error already go to stderr — leave them.

    // Dynamically import to avoid bundling issues
    const { StdioServerTransport, McpServer } = await import('@frontmcp/protocol');

    // Parse config: disable HTTP server, disable console logging, enable file logging.
    // All structured logs go to ~/.frontmcp/logs/ — stdout stays clean for MCP protocol.
    const parsedConfig = frontMcpMetadataSchema.parse({
      ...options,
      http: undefined,
    });
    // Force console logging off and file transport on (same pattern as createForCli)
    if (parsedConfig.logging) {
      parsedConfig.logging.enableConsole = false;
      const transports = parsedConfig.logging.transports ?? [];
      if (!transports.includes(FileLogTransportInstance)) {
        transports.push(FileLogTransportInstance);
      }
      parsedConfig.logging.transports = transports;
    } else {
      (parsedConfig as Record<string, unknown>)['logging'] = {
        enableConsole: false,
        transports: [FileLogTransportInstance],
      };
    }

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

    // Channel capabilities (experimental extension for Claude Code)
    const channelCapabilities = scope.channels?.getCapabilities() ?? {};

    // Build channel instructions for Claude Code if channels exist
    const channelInstructions = scope.channels?.hasAny()
      ? `Events arrive as <channel> tags. ${
          scope.channels.getChannelInstances().some((ch) => ch.twoWay) ? 'Reply with the channel-reply tool.' : ''
        }`
      : '';

    const serverOptions = {
      instructions: channelInstructions,
      capabilities: {
        ...remoteCapabilities,
        ...scope.tools.getCapabilities(),
        ...scope.resources.getCapabilities(),
        ...scope.prompts.getCapabilities(),
        ...scope.agents.getCapabilities(),
        ...channelCapabilities,
        ...completionsCapability,
        ...computeTaskCapabilities(scope),
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

        return originalHandler(request as any, enrichedCtx as any);
      };
      // Cast required: MCP SDK's handler type expects specific context shape,
      // but our wrapped handlers preserve all context properties via pass-through

      mcpServer.setRequestHandler(handler.requestSchema, wrappedHandler as any);
    }

    // Create stdio transport and connect
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    // Register server and auto-subscribe stdio session to all channels
    // (stdio sessions always have channel capability since we advertise it)
    scope.notifications.registerServer(sessionId, mcpServer);
    if (scope.channels?.hasAny()) {
      const channelNames = scope.channels.getChannelInstances().map((ch: { name: string }) => ch.name);
      scope.notifications.subscribeAllChannels(sessionId, channelNames);
    }

    // Graceful shutdown: cleanup resources then exit with code 0.
    // A ref'd timer keeps the event loop alive while async cleanup runs —
    // without it, closing the transport removes the last ref (stdin) and the
    // process exits via the raw signal before process.exit(0) is reached.
    // This is the same pattern used by Express/Fastify for graceful shutdown.
    let shuttingDown = false;
    const shutdownHandler = async () => {
      if (shuttingDown) return; // prevent re-entry from second signal
      shuttingDown = true;
      const deadline = setTimeout(() => process.exit(1), 5000);
      try {
        scope.notifications.unregisterServer(sessionId);
        await scope.shutdown();
        await mcpServer.close();
      } catch (err) {
        console.error('Error closing MCP server:', err);
      } finally {
        clearTimeout(deadline);
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);
  }
}
