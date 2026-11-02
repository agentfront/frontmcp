import {
  App,
  DynamicPlugin,
  FrontMcpConfig,
  FrontMcpContextStorage,
  HttpHook,
  Plugin,
  ScopeEntry,
  type FlowCtxOf,
  type FrontMcpConfigType,
  type ProviderType,
  type Reference,
  type ServerRequest,
} from '@frontmcp/sdk';

// Auth
import { DashboardDisabledError, DashboardUnauthorizedError, markDashboardGatePassed } from '../auth/dashboard-access';
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
// Providers
import { GraphDataProvider } from '../providers';
// Tools
import GraphTool from '../tools/graph.tool';
import ListResourcesTool from '../tools/list-resources.tool';
import ListToolsTool from '../tools/list-tools.tool';
import { DashboardPageRoute } from './dashboard-page.route';

/**
 * Internal Dashboard HTTP Plugin.
 *
 * Gates the dashboard's MCP endpoint; `DashboardPageRoute` serves the page. The SSE transport
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
   * Provide the dashboard config via DI.
   */
  static override dynamicProviders(options: DashboardPluginOptionsInput): ProviderType[] {
    // NOTE: the operator's options are resolved INSIDE the factory, not here.
    // `DashboardApp` declares this plugin inside an `@App` decorator, which runs
    // at module-import time — strictly before `DashboardPlugin.init(...)` is
    // evaluated in the `@FrontMcp` metadata. Reading the published options at
    // this point would always see the defaults, which is how the operator's
    // `auth` and `basePath` came to be silently discarded
    // (GHSA-rgxj-434m-vxh3). The factory runs at scope-construction time, by
    // which point `init(...)` has published.
    return [
      {
        name: 'dashboard:config',
        provide: DashboardConfigToken,
        inject: () => [] as const,
        useFactory: () => resolveDashboardOptions(options),
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
 * The dashboard UI is loaded from CDN (esm.sh by default) and reads the server's
 * structure from the dashboard's own MCP endpoint, at the dashboard's path.
 *
 * @example
 * ```typescript
 * import { DashboardApp } from '@frontmcp/plugin-dashboard';
 *
 * @FrontMcp({
 *   info: { name: 'my-server', version: '1.0.0' },
 *   apps: [MyApp, DashboardApp],
 * })
 * class MyServer {}
 * ```
 *
 * Then open the dashboard at `http://localhost:3000/dashboard`. Register `DashboardPlugin.init()` to set its options.
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
  routes: [DashboardPageRoute],
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
