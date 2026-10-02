import { DynamicPlugin, Plugin, ScopeEntry, type ProviderType } from '@frontmcp/sdk';

import { WebMcpBridge } from './webmcp.bridge';
import { webMcpPluginOptionsSchema, type WebMcpPluginOptions, type WebMcpPluginOptionsInput } from './webmcp.options';

/**
 * Exposes the server's tools to in-browser agents through WebMCP (`document.modelContext`).
 *
 * Install it on a server that runs in the page, with `WebMcpPlugin.init()`:
 *
 * ```typescript
 * const server = await create({
 *   info: { name: 'shop', version: '1.0.0' },
 *   tools: [SearchProducts, AddToCart],
 *   plugins: [WebMcpPlugin.init({ prefix: 'shop.' })],
 * });
 * ```
 *
 * Every tool the `'webmcp'` surface may list is registered once the server is ready, kept in sync as
 * tools come and go (including tools added with `server.registerTool()`), and unregistered when the
 * server is disposed. Calls run the `tools:call-tool` flow, so hooks, authorities and quota apply.
 */
@Plugin({
  name: 'webmcp',
  description: "Exposes the server's tools to in-browser agents through WebMCP (document.modelContext)",
})
export default class WebMcpPlugin extends DynamicPlugin<WebMcpPluginOptions, WebMcpPluginOptionsInput> {
  readonly options: WebMcpPluginOptions;

  constructor(options: WebMcpPluginOptionsInput = {}) {
    super();
    this.options = webMcpPluginOptionsSchema.parse(options);
  }

  static override dynamicProviders(options: WebMcpPluginOptionsInput): ProviderType[] {
    const parsedOptions = webMcpPluginOptionsSchema.parse(options);
    return [
      {
        name: 'webmcp:bridge',
        provide: WebMcpBridge,
        inject: () => [ScopeEntry],
        useFactory: (scope: ScopeEntry) => {
          const bridge = new WebMcpBridge(scope, parsedOptions);
          // Built while the scope initializes, before its tools exist: start once it is ready.
          // Awaiting here would wait on the very initialization that is building this provider.
          void scope.ready.then(
            () => bridge.start(),
            () => undefined, // the scope failed to start, and reports that itself
          );
          scope.onDispose(() => bridge.stop());
          return bridge;
        },
      },
    ];
  }
}
