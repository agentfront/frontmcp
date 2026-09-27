import {
  App,
  DynamicPlugin,
  FrontMcpConfig,
  FrontMcpContextStorage,
  FrontMcpServer,
  HttpHook,
  Plugin,
  ScopeEntry,
  type FlowCtxOf,
  type FrontMcpConfigType,
  type NextFn,
  type ProviderType,
  type Reference,
  type ServerRequest,
  type ServerResponse,
} from '@frontmcp/sdk';

// Auth
import { DashboardDisabledError, DashboardUnauthorizedError, markDashboardGatePassed } from '../auth/dashboard-access';
import {
  createDashboardAuthValidator,
  DASHBOARD_SESSION_COOKIE,
  deriveDashboardCookieValue,
} from '../auth/dashboard-auth';
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

type HeaderWriter = { setHeader?: (name: string, value: string | string[]) => void };

/** The page's session cookie, one per path the page and its MCP client use. */
function sessionCookies(options: DashboardPluginOptions, paths: string[], secure: boolean): string[] {
  const token = options.auth.token;
  if (!options.auth.enabled || !token) return [];
  const value = deriveDashboardCookieValue(token);
  return paths.map(
    (path) =>
      `${DASHBOARD_SESSION_COOKIE}=${value}; Path=${path}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`,
  );
}

function isHttps(req: ServerRequest): boolean {
  const socket = req.socket as { encrypted?: boolean } | undefined;
  const forwarded = req.headers?.['x-forwarded-proto'];
  return socket?.encrypted === true || (typeof forwarded === 'string' && forwarded.split(',')[0]?.trim() === 'https');
}

/**
 * Create the middleware that serves the dashboard page at `basePath`.
 *
 * The page holds no data; its client reads the inventory from the dashboard's MCP
 * endpoint (`mcpPath`), which the `http:request` hook on {@link DashboardHttpPlugin} gates.
 * When `auth` is on, a page request that shows the token also gets an HttpOnly,
 * `SameSite=Strict` cookie, which is how the page's own MCP client (an `EventSource`,
 * which cannot send headers) authenticates without a token in a URL.
 */
function createDashboardMiddleware(options: DashboardPluginOptions, mcpPath: string) {
  const html = generateDashboardHtml(options, mcpPath);
  const authorize = createDashboardAuthValidator(options.auth, 'page');
  const cookiePaths = [...new Set([mcpPath, options.basePath])];

  return async (req: ServerRequest, res: ServerResponse, next: NextFn) => {
    // Skip if dashboard is disabled
    if (!isDashboardEnabled(options)) {
      return next();
    }

    const urlPath = (req.path || req.url || '/') as string;
    const method = ((req.method as string) || 'GET').toUpperCase();
    const isPageRequest = method === 'GET' && (urlPath === '/' || urlPath === '');

    if (!isPageRequest) {
      // MCP requests under the same path belong to the dashboard's MCP scope, which the
      // `http:request` hook gates.
      return next();
    }

    // Token gate (GHSA-rgxj-434m-vxh3) for the page itself.
    if (authorize) {
      const result = authorize({
        headers: req.headers as Record<string, string | string[] | undefined> | undefined,
        query: req.query as Record<string, string | string[] | undefined> | undefined,
      });
      if (!result.authorized) {
        res.status(result.status ?? 401).json({ error: 'Unauthorized', message: result.message ?? 'Unauthorized' });
        return;
      }
    }

    // ServerResponse extends HttpServerResponse which has setHeader
    // Use optional chaining for environments that may not support it
    const writer = res as unknown as HeaderWriter;
    writer.setHeader?.('Content-Type', 'text/html');
    const cookies = sessionCookies(options, cookiePaths, isHttps(req));
    if (cookies.length > 0) writer.setHeader?.('Set-Cookie', cookies);
    res.status(200).send(html);
  };
}

/**
 * Internal Dashboard HTTP Plugin.
 *
 * Serves the dashboard HTML, and gates the dashboard's MCP endpoint. The SSE transport
 * and MCP protocol are handled by FrontMCP's built-in transport layer.
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
   * Gate every request the dashboard's MCP endpoint is about to handle.
   *
   * `enabled` and `auth` used to reach only the page middleware, so with the dashboard
   * turned off, or without its token, `POST /dashboard` still answered `initialize` and
   * `dashboard:graph` returned the whole server's inventory. This hook runs in the
   * dashboard scope's `http:request` flow, on Node and on the fetch handler alike, after
   * the router picked an MCP transport and before any of them runs. The server's own
   * authentication (the `checkAuthorization` stage) still applies first; the dashboard
   * token is required on top of it.
   */
  @HttpHook.Will('handleMcp2026', { priority: 1000 })
  async gateDashboardMcp(flowCtx: FlowCtxOf<'http:request'>): Promise<void> {
    const options = this.resolve<DashboardPluginOptions>(DashboardConfigToken) ?? resolveDashboardOptions();
    if (!isDashboardEnabled(options)) {
      throw new DashboardDisabledError();
    }

    const authorize = createDashboardAuthValidator(options.auth, 'mcp');
    if (!authorize) return;

    const request = flowCtx.rawInput.request as ServerRequest;
    const result = authorize({
      headers: request.headers as Record<string, string | string[] | undefined> | undefined,
      query: request.query as Record<string, string | string[] | undefined> | undefined,
    });
    if (!result.authorized) {
      throw new DashboardUnauthorizedError();
    }
    markDashboardGatePassed(this.resolve(FrontMcpContextStorage)?.getStore());
  }

  /** `this.get`, or `undefined` when the token isn't provided. */
  private resolve<T>(token: Reference<T>): T | undefined {
    try {
      return this.get(token);
    } catch {
      return undefined;
    }
  }

  /**
   * Provide the dashboard config and page middleware registration via DI.
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
        inject: () => [FrontMcpServer, ScopeEntry] as const,
        useFactory: (server: FrontMcpServer, scope: ScopeEntry) => {
          const effectiveOptions = resolveDashboardOptions(options);
          // The page moves with `basePath`; the MCP endpoint its client talks to is the
          // dashboard scope's own route (`/dashboard`, after the server's `entryPath`).
          const mcpPath = scope.fullPath;
          server.registerMiddleware(effectiveOptions.basePath, createDashboardMiddleware(effectiveOptions, mcpPath));
          return { registered: true, mcpPath };
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
