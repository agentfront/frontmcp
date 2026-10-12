import { DynamicPlugin, Plugin, type ProviderType } from '@frontmcp/sdk';

import { publishDashboardOptions } from './dashboard.config-store';
import { DashboardConfigToken } from './dashboard.symbol';
import {
  dashboardPluginOptionsSchema,
  defaultDashboardPluginOptions,
  type DashboardPluginOptions,
  type DashboardPluginOptionsInput,
} from './dashboard.types';

/**
 * FrontMCP Dashboard Plugin.
 *
 * Adds a visual dashboard to your FrontMCP server for:
 * - Viewing server structure (tools, resources, prompts, apps)
 * - Real-time monitoring via MCP protocol
 * - Graph-based visualization of your MCP architecture
 *
 * The dashboard UI is loaded from CDN (esm.sh by default) and reads the server's
 * structure from the dashboard's own MCP endpoint, at the dashboard's path.
 *
 * `DashboardApp` serves the dashboard; this plugin, registered with `init()`, sets its options.
 *
 * @example Basic usage
 * ```typescript
 * import { DashboardApp, DashboardPlugin } from '@frontmcp/plugin-dashboard';
 *
 * @FrontMcp({
 *   info: { name: 'my-server', version: '1.0.0' },
 *   apps: [MyApp, DashboardApp],
 *   plugins: [DashboardPlugin.init()],
 * })
 * class MyServer {}
 * ```
 *
 * @example With authentication
 * ```typescript
 * @FrontMcp({
 *   info: { name: 'my-server', version: '1.0.0' },
 *   apps: [MyApp, DashboardApp],
 *   plugins: [
 *     DashboardPlugin.init({
 *       auth: { enabled: true, token: process.env.DASHBOARD_TOKEN },
 *     }),
 *   ],
 * })
 * class MyServer {}
 *
 * // Access: http://localhost:3000/dashboard?token=<DASHBOARD_TOKEN>
 * ```
 *
 * @example With custom CDN entrypoint
 * ```typescript
 * @FrontMcp({
 *   info: { name: 'my-server', version: '1.0.0' },
 *   apps: [MyApp, DashboardApp],
 *   plugins: [
 *     DashboardPlugin.init({
 *       cdn: {
 *         entrypoint: 'https://cdn.example.com/dashboard-ui@1.0.0/index.js',
 *       },
 *     }),
 *   ],
 * })
 * class MyServer {}
 * ```
 */
@Plugin({
  name: 'dashboard',
  description: 'Visual dashboard for FrontMCP server monitoring and visualization',
  providers: [],
})
export default class DashboardPlugin extends DynamicPlugin<DashboardPluginOptions, DashboardPluginOptionsInput> {
  options: DashboardPluginOptions;

  constructor(options: DashboardPluginOptionsInput = {}) {
    super();
    // Parse options with Zod schema to apply all defaults
    this.options = dashboardPluginOptionsSchema.parse({
      ...defaultDashboardPluginOptions,
      ...options,
    });
    publishDashboardOptions(this.options);
  }

  /**
   * Dynamic providers allow configuration of the dashboard with custom options.
   * This injects the parsed options into the DI container so all dashboard
   * components can access the configuration.
   */
  static override dynamicProviders(options: DashboardPluginOptionsInput): ProviderType[] {
    // Parse options with Zod schema to apply all defaults
    const parsedOptions = dashboardPluginOptionsSchema.parse({
      ...defaultDashboardPluginOptions,
      ...options,
    });
    // Also reachable by `DashboardApp`'s HTTP plugin, which is declared inside
    // a decorator and so cannot be handed these options directly.
    publishDashboardOptions(parsedOptions);

    return [
      {
        name: 'dashboard:config',
        provide: DashboardConfigToken,
        useValue: parsedOptions,
      },
    ];
  }
}
