import {
  App,
  DynamicPlugin,
  FrontMcpConfig,
  FrontMcpServer,
  Plugin,
  ScopeEntry,
  type FrontMcpConfigType,
  type NextFn,
  type ProviderType,
  type ServerRequest,
  type ServerResponse,
} from '@frontmcp/sdk';

// Auth
import { createDashboardAuthValidator } from '../auth/dashboard-auth';
import { resolveDashboardOptions } from '../dashboard.config-store';
// Types and symbols
import { DashboardConfigToken, ParentScopeToken } from '../dashboard.symbol';
import {
  dashboardPluginOptionsSchema,
  defaultDashboardPluginOptions,
  isDashboardEnabled,
  type DashboardPluginOptions,
  type DashboardPluginOptionsInput,
} from '../dashboard.types';
// HTML Generator
import { generateDashboardHtml } from '../html/html.generator';
// Providers
import { GraphDataProvider } from '../providers';
// Tools
import GraphTool from '../tools/graph.tool';
import ListResourcesTool from '../tools/list-resources.tool';
import ListToolsTool from '../tools/list-tools.tool';

/**
 * Token for tracking middleware registration.
 */
const DashboardMiddlewareToken = Symbol('dashboard:middleware');

/**
 * Create the dashboard middleware handler.
 * Serves the generated HTML page that loads UI from CDN.
 */
function createDashboardMiddleware(options: DashboardPluginOptions) {
  const html = generateDashboardHtml(options);
  const authorize = createDashboardAuthValidator(options.auth);

  return async (req: ServerRequest, res: ServerResponse, next: NextFn) => {
    // Skip if dashboard is disabled
    if (!isDashboardEnabled(options)) {
      return next();
    }

    const urlPath = (req.path || req.url || '/') as string;
    const method = ((req.method as string) || 'GET').toUpperCase();
    const isPageRequest = method === 'GET' && (urlPath === '/' || urlPath === '');

    // Token gate (GHSA-rgxj-434m-vxh3), scoped to the PAGE request only.
    //
    // The page is what this token protects — it is the disclosure, since it
    // names the dashboard's endpoints. Everything else under `basePath` (the
    // SSE stream, the MCP POSTs) belongs to the dashboard's MCP scope, which
    // authenticates with the server's own policy; demanding the dashboard token
    // there would reject clients holding a perfectly good server credential.
    if (isPageRequest && authorize) {
      const result = authorize({
        headers: req.headers as Record<string, string | string[] | undefined> | undefined,
        query: req.query as Record<string, string | string[] | undefined> | undefined,
      });
      if (!result.authorized) {
        res.status(result.status ?? 401).json({ error: 'Unauthorized', message: result.message ?? 'Unauthorized' });
        return;
      }
    }

    if (isPageRequest) {
      // ServerResponse extends HttpServerResponse which has setHeader
      // Use optional chaining for environments that may not support it
      (res as unknown as { setHeader?: (name: string, value: string) => void }).setHeader?.(
        'Content-Type',
        'text/html',
      );
      res.status(200).send(html);
      return;
    }

    // Pass through all other requests (SSE will be handled by FrontMCP transport)
    return next();
  };
}

/**
 * Internal Dashboard HTTP Plugin.
 *
 * Handles HTTP requests for serving the dashboard HTML.
 * The SSE transport and MCP protocol are handled by FrontMCP's built-in transport layer.
 */
@Plugin({
  name: 'dashboard:http',
  description: 'Dashboard HTTP handler for serving UI HTML',
})
class DashboardHttpPlugin extends DynamicPlugin<DashboardPluginOptions, DashboardPluginOptionsInput> {
  options: DashboardPluginOptions;

  constructor(options: DashboardPluginOptionsInput = {}) {
    super();
    this.options = dashboardPluginOptionsSchema.parse({
      ...defaultDashboardPluginOptions,
      ...options,
    });
  }

  /**
   * Provide the dashboard config and middleware registration via DI.
   */
  static override dynamicProviders(options: DashboardPluginOptionsInput): ProviderType[] {
    // NOTE: the operator's options are resolved INSIDE the factories, not here.
    // `DashboardApp` declares this plugin inside an `@App` decorator, which runs
    // at module-import time — strictly before `DashboardPlugin.init(...)` is
    // evaluated in the `@FrontMcp` metadata. Reading the published options at
    // this point would always see the defaults, which is how the operator's
    // `auth` and `basePath` came to be silently discarded
    // (GHSA-rgxj-434m-vxh3). The factories run at scope-construction time, by
    // which point `init(...)` has published.
    return [
      {
        name: 'dashboard:config',
        provide: DashboardConfigToken,
        inject: () => [] as const,
        useFactory: () => resolveDashboardOptions(options),
      },
      // Register middleware for HTML serving (must be in dynamic providers to access config)
      {
        name: 'dashboard:middleware',
        provide: DashboardMiddlewareToken,
        inject: () => [FrontMcpServer] as const,
        useFactory: (server: FrontMcpServer) => {
          const effectiveOptions = resolveDashboardOptions(options);
          const middleware = createDashboardMiddleware(effectiveOptions);
          // Register at the configured basePath
          server.registerMiddleware(effectiveOptions.basePath, middleware);
          return { registered: true };
        },
      },
    ];
  }
}

/**
 * FrontMCP Dashboard App.
 *
 * A dashboard application that provides:
 * - Server structure visualization via MCP tools
 * - Real-time event streaming via SSE (built into FrontMCP)
 * - Access to server scope for monitoring
 *
 * The dashboard UI is loaded from CDN (esm.sh by default) and connects
 * to the dashboard via MCP protocol over SSE transport.
 *
 * @example
 * ```typescript
 * import { DashboardApp } from '@frontmcp/plugins';
 *
 * @FrontMCP({
 *   name: 'my-server',
 *   apps: [DashboardApp],
 * })
 * class MyServer {}
 * ```
 *
 * Then access the dashboard at `http://localhost:3000/dashboard`
 * The dashboard connects via SSE at the standard `/sse` endpoint.
 */
@App({
  name: 'dashboard',
  description: 'FrontMCP Dashboard for visualization and monitoring',
  providers: [
    // Provide parent scope reference (same as current scope when standalone: false)
    {
      name: 'dashboard:parent-scope',
      provide: ParentScopeToken,
      inject: () => [ScopeEntry] as const,
      useFactory: (scope: ScopeEntry) => {
        return scope;
      },
    },
    // Graph data provider for extracting server structure
    {
      name: 'dashboard:graph-data',
      provide: GraphDataProvider,
      inject: () => [ScopeEntry, FrontMcpConfig] as const,
      useFactory: (scope: ScopeEntry, config: FrontMcpConfigType) => {
        const serverName = config.info?.name || 'FrontMCP Server';
        const serverVersion = config.info?.version;
        return new GraphDataProvider(scope, serverName, serverVersion);
      },
    },
  ],
  plugins: [DashboardHttpPlugin.init({})],
  tools: [GraphTool, ListToolsTool, ListResourcesTool],
  // No `auth` block: the dashboard scope INHERITS the server's authentication
  // policy. It used to hard-code `mode: 'public'`, which made
  // `dashboard:graph` / `list-tools` / `list-resources` — and through them the
  // whole server's inventory — anonymously reachable regardless of how the
  // server itself was authenticated (GHSA-rgxj-434m-vxh3). A server that wants
  // an open dashboard declares `auth: { mode: 'public' }` for itself.
  standalone: true, // Isolated scope; GraphDataProvider walks up to the root ScopeRegistry for the full inventory
})
export class DashboardApp {}

// Export the HTTP plugin for advanced use cases
export { DashboardHttpPlugin };
