# @frontmcp/edge

Run a [FrontMCP](https://github.com/agentfront/frontmcp) MCP server on a V8-isolate
runtime — **Cloudflare Workers**, Deno Deploy, Bun — from a plain config object.

No `@FrontMcp` decorator, no `frontmcp build` step. The Worker entry imports this
package, passes a config, and exports the returned `fetch` handler. The Web
`Request` is routed straight into the MCP WebStandard transport (no Express, no
Node `req`/`res` shim).

## Usage

```ts
// worker.ts
import { createEdgeMcp } from '@frontmcp/edge';
import { MyApp } from './apps';

export default createEdgeMcp({
  info: { name: 'my-worker', version: '1.0.0' },
  apps: [MyApp],
  // Background tasks need distributed storage (Redis/Upstash) on edge runtimes.
  tasks: { enabled: false },
});
```

```toml
# wrangler.toml
name = "my-worker"
main = "worker.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

```bash
wrangler dev      # local
wrangler deploy   # ship
```

## Managed mode (auto-updating)

Point the edge server at a SaaS endpoint that serves a **signed skilled-openapi
bundle** (OpenAPI specs compiled into MCP skills + tools). The bundle is pulled
on boot and kept fresh by polling (and/or a push webhook), so capabilities
update **without redeploying**.

```ts
import { createEdgeMcp } from '@frontmcp/edge';

export default createEdgeMcp({
  info: { name: 'my-worker', version: '1.0.0' },
  apps: [],
  tasks: { enabled: false },
  managed: {
    endpoint: 'https://cloud.frontmcp.dev/v1/bundles/acme',
    authToken: env.FRONTMCP_PULL_TOKEN,
    expectedAudience: 'acme-mcp',
    jwksUrl: 'https://cloud.frontmcp.dev/.well-known/jwks.json',
    expectedIssuer: 'https://cloud.frontmcp.dev',
    pollIntervalMs: 300_000, // optional — auto-refresh every 5 min (default)
    enableWebhook: true,     // optional — also accept synchronous pushes
  },
});
```

Managed mode requires the optional peer **`@frontmcp/plugin-skilled-openapi`**
(it provides the SaaS-pull source, signature verification, replay/SSRF guards,
and last-good cache fallback). Install it alongside `@frontmcp/edge` when using
`managed`.

## Notes

- The FrontMCP scope is built **lazily on the first request** and memoized — V8
  isolates forbid timers / random / I-O at module-eval scope.
- The handler is currently **stateless**. Durable Object–backed sessions and
  KV/D1/R2 stores arrive with `@frontmcp/adapters/cloudflare`.
- Requires `@frontmcp/sdk` as a peer dependency.

## API

### `createEdgeMcp(config): { fetch }`

Builds a Worker module from a FrontMCP config (the same shape `@FrontMcp(...)`
accepts). Returns `{ fetch(request, env?, ctx?): Promise<Response> }`.
