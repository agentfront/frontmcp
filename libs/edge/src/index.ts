/**
 * `@frontmcp/edge` — run a FrontMCP server on a V8-isolate runtime
 * (Cloudflare Workers, Deno Deploy, Bun) from a plain config object.
 *
 * No `@FrontMcp` decorator, no `frontmcp build` step: the edge entry imports
 * this package, passes a config, and exports the returned `fetch` handler. The
 * bundler (wrangler/esbuild) handles the rest.
 *
 * ```ts
 * // worker.ts (~10 lines)
 * import { createEdgeMcp } from '@frontmcp/edge';
 * import { MyApp } from './apps';
 *
 * export default createEdgeMcp({
 *   info: { name: 'my-worker', version: '1.0.0' },
 *   apps: [MyApp],
 *   tasks: { enabled: false }, // edge has no Redis here
 * });
 * ```
 *
 * **Managed mode** (auto-updating): point it at a SaaS endpoint serving a
 * signed skilled-openapi bundle (OpenAPI → skills + tools), pulled on boot and
 * refreshed by polling — no redeploy on capability changes.
 *
 * ```ts
 * export default createEdgeMcp({
 *   info: { name: 'my-worker', version: '1.0.0' },
 *   apps: [],
 *   tasks: { enabled: false },
 *   managed: {
 *     endpoint: 'https://cloud.frontmcp.dev/v1/bundles/acme',
 *     authToken: env.FRONTMCP_PULL_TOKEN,
 *     expectedAudience: 'acme-mcp',
 *     jwksUrl: 'https://cloud.frontmcp.dev/.well-known/jwks.json',
 *     expectedIssuer: 'https://cloud.frontmcp.dev',
 *   },
 * });
 * ```
 */
import { FrontMcpInstance, createWebFetchHandler, type WebFetchHandler } from '@frontmcp/sdk';

import { buildManagedOpenApiPluginOptions, type ManagedEdgeOptions } from './managed';

export type { ManagedEdgeOptions } from './managed';
export { buildManagedOpenApiPluginOptions } from './managed';

/** The plain FrontMCP config the SDK accepts (same shape `@FrontMcp(...)` takes). */
type BaseConfig = Parameters<typeof FrontMcpInstance.createForGraph>[0];

/**
 * Config accepted by {@link createEdgeMcp} — the FrontMCP config plus an
 * optional `managed` block for the auto-updating skilled-openapi path.
 */
export type EdgeMcpConfig = BaseConfig & {
  /**
   * Managed mode — pull an auto-updating skilled-openapi bundle from a SaaS
   * endpoint. Requires the optional peer `@frontmcp/plugin-skilled-openapi`.
   */
  managed?: ManagedEdgeOptions;
};

// The Scope shape `createWebFetchHandler` expects (not re-exported from the SDK
// root; derived to avoid widening the SDK's public surface).
type Scope = Parameters<typeof createWebFetchHandler>[0];

/** An edge module: `export default createEdgeMcp(config)`. */
export interface EdgeMcp {
  fetch: (request: Request, env?: unknown, ctx?: unknown) => Promise<Response>;
}

/**
 * Build an edge module (`{ fetch }`) from a FrontMCP config.
 *
 * The FrontMCP scope is built **lazily on the first request** and memoized —
 * V8 isolates forbid timers / random / I-O at module-eval (global) scope, and
 * scope initialization legitimately does those; deferring to the first `fetch`
 * runs that work inside a request context, where it is allowed.
 *
 * Durable Object classes (sessions/event store) are not part of this skeleton
 * yet — the handler is stateless. They arrive with `@frontmcp/adapters/cloudflare`.
 */
export function createEdgeMcp(config: EdgeMcpConfig): EdgeMcp {
  let handlerPromise: Promise<WebFetchHandler> | undefined;

  const build = async (): Promise<WebFetchHandler> => {
    const { managed, ...base } = config;
    let frontmcpConfig = base as BaseConfig;

    if (managed) {
      // Wire the skilled-openapi plugin (SaaS source) so the bundle is pulled
      // on boot and auto-refreshed. Lazy-imported so non-managed edges never
      // pay for it. The literal specifier stays bundlable by wrangler.
      const mod = await import('@frontmcp/plugin-skilled-openapi');
      const SkilledOpenApiPlugin = (mod as { default: { init(options: unknown): unknown } }).default;
      const plugin = SkilledOpenApiPlugin.init(buildManagedOpenApiPluginOptions(managed));
      const existingPlugins = ((base as { plugins?: unknown[] }).plugins ?? []) as unknown[];
      frontmcpConfig = { ...base, plugins: [...existingPlugins, plugin] } as BaseConfig;
    }

    const instance = await FrontMcpInstance.createForGraph(frontmcpConfig);
    const scope = instance.getScopes()[0] as Scope | undefined;
    if (!scope) {
      throw new Error('createEdgeMcp: the config produced no scope — declare an app/tool or `managed`.');
    }
    return createWebFetchHandler(scope);
  };

  return {
    async fetch(request: Request): Promise<Response> {
      handlerPromise ??= build();
      const handler = await handlerPromise;
      return handler(request);
    },
  };
}
