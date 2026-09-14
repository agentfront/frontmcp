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
 * The dashboard UI is loaded from CDN (esm.sh by default) and connects
 * to the dashboard via MCP protocol over SSE transport.
 *
 * @example Basic usage
 * ```typescript
 * import { DashboardPlugin } from '@frontmcp/plugins';
 *
 * @FrontMCP({
 *   name: 'my-server',
 *   plugins: [new DashboardPlugin()],
 * })
 * class MyServer {}
 * ```
 *
 * @example With authentication
 * ```typescript
 * @FrontMCP({
 *   name: 'my-server',
 *   plugins: [
 *     new DashboardPlugin({
 *       auth: { enabled: true, token: 'my-secret-token' },
 *     }),
 *   ],
 * })
 * class MyServer {}
 *
 * // Access: http://localhost:3000/dashboard?token=my-secret-token
 * ```
 *
 * @example With custom CDN entrypoint
 * ```typescript
 * @FrontMCP({
 *   name: 'my-server',
 *   plugins: [
 *     new DashboardPlugin({
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
