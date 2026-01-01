import {
  App,
  Plugin,
  DynamicPlugin,
  ScopeEntry,
  FrontMcpConfig,
  FrontMcpServer,
  ServerRequest,
  ServerResponse,
  ProviderType,
  type FrontMcpConfigType,
} from '@frontmcp/sdk';

// Types and symbols
import { DashboardConfigToken, GraphDataProviderToken, ParentScopeToken } from '../dashboard.symbol';
import {
  DashboardPluginOptions,
  DashboardPluginOptionsInput,
  dashboardPluginOptionsSchema,
  defaultDashboardPluginOptions,
  isDashboardEnabled,
} from '../dashboard.types';

// Providers
import { GraphDataProvider } from '../providers';

// Tools
import GraphTool from '../tools/graph.tool';
import ListToolsTool from '../tools/list-tools.tool';
import ListResourcesTool from '../tools/list-resources.tool';

// HTML Generator
import { generateDashboardHtml } from '../html/html.generator';

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

  return async (req: ServerRequest, res: ServerResponse, next: () => void) => {
    // Skip if dashboard is disabled
    if (!isDashboardEnabled(options)) {
      return next();
    }

    const urlPath = (req.path || req.url || '/') as string;
    const method = ((req.method as string) || 'GET').toUpperCase();

    // Only serve HTML for GET requests to the root path
    if (method === 'GET' && (urlPath === '/' || urlPath === '')) {
      (res as any).setHeader?.('Content-Type', 'text/html');
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
    const parsedOptions = dashboardPluginOptionsSchema.parse({
      ...defaultDashboardPluginOptions,
      ...options,
    });
    return [
      {
        name: 'dashboard:config',
        provide: DashboardConfigToken,
        useValue: parsedOptions,
      },
      // Register middleware for HTML serving (must be in dynamic providers to access config)
      {
        name: 'dashboard:middleware',
        provide: DashboardMiddlewareToken,
        inject: () => [FrontMcpServer] as const,
        useFactory: (server: FrontMcpServer) => {
          const middleware = createDashboardMiddleware(parsedOptions);
          // Register at /dashboard basePath
          server.registerMiddleware(parsedOptions.basePath, middleware as any);
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
  auth: {
    mode: 'public',
  },
  standalone: true, // - dashboard is part of root scope so GraphDataProvider can access all tools/resources
})
export class DashboardApp {}

// Export the HTTP plugin for advanced use cases
export { DashboardHttpPlugin };
