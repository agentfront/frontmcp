import { fileExists, randomUUID, unlink } from '@frontmcp/utils';

import {
  FrontMcpLogger,
  frontMcpMetadataSchema,
  FrontMcpServer,
  getDecoratorConfig,
  parseFrontMcpConfigLite,
  type FrontMcpConfigInput,
  type FrontMcpConfigType,
  type FrontMcpInterface,
  type ScopeEntry,
} from '../common';
import { type SqliteOptionsInput } from '../common/types/options/sqlite/schema';
import { DirectMcpServerImpl, type DirectMcpServer } from '../direct';
import { InternalMcpError, ServerNotFoundError } from '../errors';
import { HealthService } from '../health';
import { FileLogTransportInstance } from '../logger/instances/instance.file-logger';
import LoggerRegistry from '../logger/logger.registry';
import { createProcessStatsCollectorIfEnabled, MetricsService } from '../metrics';
import ProviderRegistry from '../provider/provider.registry';
import { type Scope } from '../scope/scope.instance';
import { ScopeRegistry } from '../scope/scope.registry';
import { type FrontMcpServerInstance } from '../server/server.instance';
import { buildChannelInstructions, composeInitializeInstructions } from '../skill/skill-instructions.helper';
import { computeTaskCapabilities } from '../task';
import { createMcpGlobalProviders } from './front-mcp.providers';

/**
 * A `@FrontMcp`-decorated server class, or the raw config object it wraps.
 * Entry points that accept either resolve a class to its stored config via
 * {@link resolveConfigInput}.
 */
export type ConfigOrServerClass = FrontMcpConfigInput | (abstract new (...args: never[]) => unknown);

/**
 * Tracks whether a stdio server has already connected in this process. stdio
 * owns the single stdin/stdout pair, so only one connection can exist — a
 * second `runStdio()` (e.g. the `@FrontMcp` decorator auto-serving plus an
 * explicit call) is ignored rather than corrupting the JSON-RPC stream by
 * attaching a second transport to stdin.
 */
let stdioServing = false;

/**
 * Normalize an argument that may be either a raw FrontMCP config object or a
 * `@FrontMcp`-decorated class. Mirrors `connect()` so every entry point accepts
 * the same inputs (#450). A class is resolved to the config the decorator
 * stored under its reflect-metadata key.
 */
function resolveConfigInput(optionsOrClass: ConfigOrServerClass): FrontMcpConfigInput {
  if (typeof optionsOrClass === 'function') {
    const stored = getDecoratorConfig(optionsOrClass);
    // `getDecoratorConfig` returns the decorator's already-parsed metadata
    // (schema output), which is a valid input to `frontMcpMetadataSchema.parse`
    // — the same round-trip `bootstrap()` relies on. The cast bridges the
    // output→input shape; callers re-parse it, so it is safe.
    if (stored) return stored as unknown as FrontMcpConfigInput;
    throw new InternalMcpError(
      'runStdio() received a class without @FrontMcp() metadata. Pass a ' +
        '@FrontMcp-decorated class, or the same config object you pass to @FrontMcp().',
    );
  }
  return optionsOrClass;
}

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

    // Wire health service from the first scope (if available)
    this.wireHealthService(server);

    // Wire metrics service when configured (issue #397). Off by default.
    this.wireMetricsService(server);

    await server.start();

    // Emit server-started lifecycle event to all scopes
    for (const scope of this.getScopes()) {
      await scope.emitServerStarted();
    }

    // Issue #399 — dev bridge bootstrap sentinel. When `frontmcp dev
    // --stdio` spawns this process, it sets FRONTMCP_DEV_BOOTSTRAP_SENTINEL=1
    // and watches stderr for this exact line to decide "the child is
    // ready, drain the buffered RPCs." Written to stderr because stdout
    // is reserved for JSON-RPC frames in stdio mode.
    if (process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'] === '1') {
      process.stderr.write('__FRONTMCP_BOOTSTRAP_COMPLETE__\n');
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

  /**
   * Wire the `/metrics` service into the server instance (issue #397).
   *
   * Off by default — `metrics.enabled` must be set to `true` explicitly.
   * The `MetricsService` is instantiated here (not in scope construction)
   * because the endpoint is server-wide, not per-app — counters and process
   * stats are process-global.
   */
  private wireMetricsService(server: FrontMcpServer): void {
    const serverInstance = server as FrontMcpServerInstance;
    if (typeof serverInstance.setMetricsService !== 'function') return;

    const metricsConfig = this.config.metrics;
    if (!metricsConfig || metricsConfig.enabled !== true) {
      serverInstance.setMetricsConfig(metricsConfig ?? {});
      return;
    }

    try {
      const processCollector = createProcessStatsCollectorIfEnabled(metricsConfig);
      const service = new MetricsService(metricsConfig, processCollector);
      serverInstance.setMetricsService(service, metricsConfig);
    } catch (err) {
      this.log?.error?.('Failed to wire /metrics endpoint', err as Error);
      throw err;
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

    const frontMcp = new FrontMcpInstance(parsedConfig);
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

    // Wire health service for serverless mode
    frontMcp.wireHealthService(server);

    // Wire metrics service for serverless mode (issue #397)
    frontMcp.wireMetricsService(server);

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
   * Runs the FrontMCP server on a Unix socket for local-only access.
   *
   * This enables a persistent background FrontMCP server accessible only via
   * a Unix `.sock` file. The entire HTTP feature set (streamable HTTP, SSE,
   * elicitation, sessions) works unchanged over Unix sockets.
   *
   * Pass the same config object you give to `@FrontMcp()` (not the decorated
   * class — spreading a class yields no config) plus the socket path.
   *
   * @example
   * ```typescript
   * import { FrontMcpInstance } from '@frontmcp/sdk';
   * import { serverConfig } from './server-config';
   *
   * const handle = await FrontMcpInstance.runUnixSocket({
   *   ...serverConfig,
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

  /**
   * Runs the FrontMCP server over **stdio** (stdin/stdout JSON-RPC) for local
   * MCP clients such as Claude Desktop, Claude Code, and Cursor. Connects the
   * transport and returns only when the connection closes. **No TCP port is
   * bound** — the HTTP server is disabled for this entry point (#451).
   *
   * Accepts either a `@FrontMcp`-decorated class or the same config object you
   * pass to `@FrontMcp()` (#450).
   *
   * IMPORTANT — importing a `@FrontMcp`-decorated class starts an HTTP server at
   * import time unless `FRONTMCP_STDIO=1` is set *before* the import. Two safe
   * patterns avoid that:
   *
   * 1. Built bundles — `frontmcp build --target node`, then run the emitted
   *    runner with `--stdio` (it sets `FRONTMCP_STDIO=1` for you, so the
   *    decorator serves over stdio). A `--target cli` binary supports
   *    `<bin> --stdio` the same way.
   * 2. Hand-written entry — keep the config object in its own module (no
   *    decorated class in the import graph) and pass it directly, as below.
   *
   * @example Hand-written stdio entry (config kept separate from the class)
   * ```typescript
   * // server-config.ts — a plain object, no @FrontMcp decorator here
   * export const serverConfig = { info: { name: 'my-server', version: '0.1.0' }, apps: [MyApp] };
   *
   * // stdio.ts
   * import { FrontMcpInstance } from '@frontmcp/sdk';
   * import { serverConfig } from './server-config';
   * FrontMcpInstance.runStdio(serverConfig);
   * ```
   *
   * @example Claude Desktop config (built `--target node` runner)
   * ```json
   * {
   *   "mcpServers": {
   *     "my-server": { "command": "/abs/path/dist/node/my-server", "args": ["--stdio"] }
   *   }
   * }
   * ```
   */
  public static async runStdio(optionsOrClass: ConfigOrServerClass): Promise<void> {
    // Resolve a decorated class to its stored config, or accept a raw config
    // object (#450). Done FIRST — before any global side effects (console
    // redirection, env flags) — so invalid input fails fast and a failed
    // resolve never trips the single-connection guard below.
    const options = resolveConfigInput(optionsOrClass);

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

    // Mark stdio mode so any @FrontMcp decorator imported from here on serves
    // over stdio rather than binding an HTTP port (#451). Guard against a
    // second stdio connection (decorator auto-serve plus an explicit call),
    // which would corrupt the JSON-RPC stream by attaching two transports to
    // the single stdin/stdout pair.
    process.env['FRONTMCP_STDIO'] = '1';
    if (stdioServing) {
      console.error('[FrontMCP] runStdio() called more than once; ignoring the duplicate stdio connection.');
      return;
    }
    stdioServing = true;
    // Track whether startup reached the point of attaching the stdio transport.
    // If initialization throws before that, reset the guard so a retry in the
    // same process isn't permanently ignored — the failed attempt never attached
    // a transport to stdin/stdout, so a second runStdio() is safe and necessary.
    let startupSucceeded = false;
    try {
      // Dynamically import to avoid bundling issues
      const { StdioServerTransport, McpServer } = await import('@frontmcp/protocol');

      // Parse config: disable the HTTP server, disable console logging, enable
      // file logging. `serve: false` selects the no-op server so no Express
      // adapter is constructed and no TCP port can ever bind (#451). All
      // structured logs go to ~/.frontmcp/logs/ — stdout stays clean for MCP.
      const parsedConfig = frontMcpMetadataSchema.parse({
        ...options,
        http: undefined,
        serve: false,
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

      // Compose `instructions` lazily on every `initialize` so dynamic skill
      // registrations after boot are reflected without restarting the server.
      // The static value below seeds the McpServer constructor for SDK
      // compatibility; the actual response is recomputed inside the handler
      // via `composeInstructions` (see initialize-request.handler.ts).
      const composeInstructions = (): string =>
        composeInitializeInstructions({
          userInstructions: scope.metadata.instructions,
          channelInstructions: buildChannelInstructions(scope.channels),
          skillRegistry: scope.skills,
          policy: scope.metadata.skillsConfig?.injectInstructions,
        });
      const instructions = composeInstructions();

      const serverOptions = {
        instructions,
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
      const handlers = createMcpHandlers({ scope, serverOptions, composeInstructions });
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
      // The transport now owns stdin/stdout — the guard must stay set even on a
      // later throw, otherwise a retry would attach a second transport and corrupt
      // the JSON-RPC stream.
      startupSucceeded = true;

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
    } finally {
      if (!startupSucceeded) {
        stdioServing = false;
      }
    }
  }
}
