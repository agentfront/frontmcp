---
name: deploy-to-cloudflare
description: Deploy a FrontMCP server to Cloudflare Workers with KV, D1, and Durable Objects
---

# Deploy a FrontMCP Server to Cloudflare Workers

This skill guides you through deploying a FrontMCP server to Cloudflare Workers.

<Warning>
Cloudflare Workers support is **experimental**. The Express-to-Workers adapter has limitations with streaming, certain middleware, and some response methods. For production Cloudflare deployments, consider using Hono or native Workers APIs.
</Warning>

## When to Use This Skill

### Must Use

- Deploying a FrontMCP server to Cloudflare Workers
- Configuring `wrangler.toml` for a FrontMCP project targeting Cloudflare
- Setting up Workers KV, D1, or Durable Objects storage for an MCP server on Cloudflare

### Recommended

- Evaluating serverless edge deployment options for low-latency MCP endpoints
- Migrating an existing Node.js MCP server to a Cloudflare Workers environment
- Adding a custom domain to a Cloudflare-hosted MCP server

### Skip When

- Deploying to a traditional Node.js server or Docker container -- use `build-for-cli` or `--target node`
- Building a browser-based MCP client -- use `build-for-browser`
- Embedding MCP tools in an existing app without HTTP -- use `build-for-sdk`

> **Decision:** Choose this skill when your deployment target is Cloudflare Workers; otherwise pick the skill that matches your runtime.

## Prerequisites

- A Cloudflare account (https://dash.cloudflare.com)
- Wrangler CLI installed: `npm install -g wrangler`
- A built FrontMCP project

## Step 1: Create a Cloudflare-targeted Project

```bash
npx frontmcp create my-app --target cloudflare
```

This generates the project with a `wrangler.toml` and a deploy script (`npm run deploy` runs `wrangler deploy`).

## Step 2: Build for Cloudflare

```bash
frontmcp build --target cloudflare
```

This produces:

```text
dist/cloudflare/
  index.js       # Cloudflare Workers entry (CommonJS) — wraps your @FrontMcp server
  main.js        # Your compiled server module (CommonJS)
wrangler.toml    # Wrangler configuration (overwritten on every build)
```

Cloudflare Workers use CommonJS (not ESM). The build command sets `--module commonjs` automatically.

> **Important:** The Cloudflare adapter sets `alwaysWriteConfig: true` and overwrites the entire `wrangler.toml` on every build with the template below. Hand-edited bindings (`[[kv_namespaces]]`, `[vars]`, `[[d1_databases]]`, etc.) WILL be erased the next time you run `frontmcp build --target cloudflare`. Configure `name`, `compatibility_date`, and extra `compatibility_flags` via your `frontmcp.config` file's `deployments[].wrangler` section, and keep bindings in a separate config file referenced from your toolchain (or re-add them after each build).

## Step 3: Configure wrangler.toml

The build always writes this. `compatibility_flags = ["nodejs_compat"]` is **always** emitted — the worker entry is an ES Module that imports `@frontmcp/sdk`'s web-fetch handler, which still transitively pulls in Node builtins (no Express on the Worker), so without the flag the deployed Worker fails to load. The default `compatibility_date` is `2024-09-23` (the date that enables full `nodejs_compat`). `main` is `dist/cloudflare/index.js`.

```toml
name = "frontmcp-worker"
main = "dist/cloudflare/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

`name`, `compatibility_date`, and any extra `compatibilityFlags` come from `frontmcp.config.{ts,js}`'s `deployments` array (`nodejs_compat` is merged in automatically). Example:

```ts
// frontmcp.config.ts
export default {
  deployments: [
    {
      target: 'cloudflare',
      wrangler: {
        name: 'my-worker',
        compatibilityDate: '2025-01-15',
        // Optional — nodejs_compat is always added for you.
        compatibilityFlags: ['nodejs_compat_populate_process_env'],
      },
    },
  ],
};
```

To add KV storage or other bindings, append them AFTER each build (or use a wrapper script that runs the build then concatenates a `wrangler.bindings.toml` you maintain separately):

```toml
name = "my-worker"
main = "dist/cloudflare/index.js"
compatibility_date = "2025-01-15"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "FRONTMCP_KV"
id = "your-kv-namespace-id"

[vars]
NODE_ENV = "production"
```

Create the KV namespace via the dashboard or CLI:

```bash
wrangler kv:namespace create FRONTMCP_KV
```

Copy the returned `id` into your `wrangler.toml`.

## Step 4: Configure the Server

```typescript
import { App, FrontMcp } from '@frontmcp/sdk';

@App({ name: 'MyApp' })
class MyApp {}

@FrontMcp({
  info: { name: 'my-worker', version: '1.0.0' },
  apps: [MyApp],
  transport: {
    protocol: 'legacy', // preset: 'legacy' | 'modern' | 'stateless-api' | 'full' — see configure-transport
  },
})
class MyServer {}

export default MyServer;
```

> **Note:** The transport schema uses `protocol`, not `type`. The preset string accepts `'legacy'` (default), `'modern'`, `'stateless-api'`, or `'full'`. For granular control, pass an object instead, e.g. `protocol: { sse: true, streamable: true }`. `transport: { type: 'sse' }` will fail Zod validation at startup.

For session storage, use Upstash Redis (HTTP) via `redis: { provider: 'vercel-kv' }` or wire Cloudflare KV directly inside your tools — the SDK does not include a built-in Cloudflare KV provider, and ioredis-style `redis: { ... }` configs are rejected by the Cloudflare adapter at build time (no Node TCP on Workers).

## Step 5: Deploy

```bash
# Preview deployment
wrangler dev

# Production deployment
wrangler deploy
```

### Custom Domain

Configure a custom domain in the Cloudflare dashboard under **Workers & Pages > your worker > Settings > Domains & Routes**, or via wrangler:

```bash
wrangler domains add mcp.example.com
```

## Step 6: Verify

```bash
# Health check (FrontMCP serves /healthz by default; /health is a legacy alias)
curl https://frontmcp-worker.your-subdomain.workers.dev/healthz

# Test MCP endpoint
curl -X POST https://frontmcp-worker.your-subdomain.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Endpoint path, CORS & SSE — config-driven

The worker's transport is driven by the standard `http` + `transport` config (the same fields the Express host reads), so behaviour is identical on both adapters. The worker serves MCP at **exactly one path** — `http.entryPath` (the worker root `/` when unset) — not a guessed `/` + `/mcp` set. Cloudflare never strips the path before it reaches the worker:

| Clients use | `http.entryPath` | `wrangler.toml` route | Worker serves |
| --- | --- | --- | --- |
| `https://mcp.example.com` (subdomain) | omit (`/`) | `routes = [{ pattern = "mcp.example.com", custom_domain = true }]` | `/` |
| `https://example.com/mcp` (path) | `'/mcp'` | `routes = [{ pattern = "example.com/mcp*", zone_name = "example.com" }]` | `/mcp` |

```ts
createEdgeMcp({
  /* …info, apps… */
  http: {
    entryPath: '/mcp',       // the ONE path MCP is served at (omit → root '/')
    cors: { origin: true },  // browser MCP clients (e.g. Inspector "Direct" mode); { origin, credentials, maxAge }
  },
  // transport: 'legacy'/'modern' → SSE streaming on POST; 'stateless-api' → buffered JSON.
});
```

- **CORS** ← `http.cors` (`false` disables; a function `origin` is unsupported on the worker — use `true` / string / `string[]`).
- **SSE** ← derived from the transport protocol (streaming under `legacy`/`modern`, buffered JSON under `stateless-api`); server→client `GET` streams are always honored.
- A trailing slash is normalized (`/mcp/` matches `/mcp`); `/healthz` + `/readyz` always answer a liveness 200 regardless of `entryPath`.

## Workers Limitations

- **Bundle size**: Workers have a 1 MB compressed / 10 MB uncompressed limit (paid plan: 10 MB / 30 MB). Review dependencies and remove unused packages to reduce bundle size.
- **CPU time**: 10 ms CPU time on free plan, 30 seconds on paid. Long-running operations must be optimized or use Durable Objects.
- **No native modules**: `better-sqlite3` and other native Node.js modules are not available. Use KV, D1, or Upstash Redis for storage.
- **Streaming**: Streamable HTTP works, including SSE responses (`POST` with `Accept: text/event-stream`) and the server→client SSE `GET` stream — the handler holds the isolate open via `ctx.waitUntil` until the stream closes. The legacy `/sse` + `/message` transport and session-correlated push need a stateful store (Durable Object), which the stateless web-fetch handler does not provide yet.

## Storage Options

| Storage       | Use Case                      | Notes                             |
| ------------- | ----------------------------- | --------------------------------- |
| Cloudflare KV | Simple key-value, low write   | Eventually consistent, fast reads |
| Upstash Redis | Sessions, pub/sub, high write | Redis-compatible REST API         |
| Cloudflare D1 | Relational data               | SQLite-based, serverless          |

## Troubleshooting

| Problem                       | Cause                                          | Solution                                                                  |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| Worker exceeds size limit     | Too many bundled dependencies                  | Review dependencies and remove unused packages to reduce bundle size      |
| Module format errors          | Worker bundled as a Service Worker             | FrontMCP Cloudflare builds emit an **ES Module Worker** (`export default { fetch }`); `nodejs_compat` requires it. Don't force `type`/CommonJS |
| KV binding errors             | Namespace not created or binding name mismatch | Run `wrangler kv:namespace create` and copy the `id` into `wrangler.toml` |
| Timeout errors                | CPU time exceeds plan limit                    | Upgrade plan or offload heavy computation to Durable Objects              |
| CORS failures on MCP endpoint | Missing CORS headers in Worker response        | `@frontmcp/edge`: pass `cors: { origin: true }` to `createEdgeMcp({...})` (transport-level CORS) |

## Common Patterns

| Pattern            | Correct                                                                    | Incorrect                         | Why                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Module format      | ES Module Worker (`main = "dist/cloudflare/index.js"`, `export default { fetch }`) | Service Worker / forced CommonJS  | FrontMCP Cloudflare builds emit an ES Module Worker at this exact path; the build overwrites `wrangler.toml`. `nodejs_compat` requires the Module shape |
| Transport key      | `transport: { protocol: 'modern' }` (or `{ sse: true, streamable: true }`) | `transport: { type: 'sse' }`      | The schema field is `protocol`; valid presets are `'legacy' \| 'modern' \| 'stateless-api' \| 'full'`, or pass a `ProtocolConfig` object |
| Storage binding    | `[[kv_namespaces]]` with matching `binding`                                | Hardcoded KV namespace ID in code | Bindings are injected at runtime by Workers                                                                                              |
| Compatibility date | Set via `frontmcp.config.deployments[].wrangler.compatibilityDate`         | Hand-editing `wrangler.toml`      | The build overwrites `wrangler.toml`; config-driven values survive                                                                       |
| Build command      | `frontmcp build --target cloudflare`                                       | `frontmcp build` (no target)      | Default target is Node.js, not Workers                                                                                                   |
| Secrets            | `wrangler secret put MY_SECRET`                                            | Storing secrets in `[vars]`       | `[vars]` are visible in plaintext in the dashboard                                                                                       |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target cloudflare` completes without errors
- [ ] Bundle size is within Cloudflare plan limits (free: 1 MB compressed)

**Configuration**

- [ ] `wrangler.toml` has correct `name`, `main`, `compatibility_date`, and `compatibility_flags = ["nodejs_compat"]`
- [ ] KV namespace IDs match between dashboard and `wrangler.toml`
- [ ] Secrets are stored via `wrangler secret put`, not in `[vars]`

**Deployment**

- [ ] `wrangler dev` serves the MCP endpoint locally
- [ ] `wrangler deploy` succeeds without errors
- [ ] Health endpoint responds with 200

**Runtime**

- [ ] `tools/list` JSON-RPC call returns expected tools
- [ ] SSE streaming works end-to-end (if using SSE transport)
- [ ] Custom domain resolves correctly (if configured)

## Examples

| Example                                                                                | Level        | Description                                                                                             |
| -------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| [`basic-worker-deploy`](../examples/deploy-to-cloudflare/basic-worker-deploy.md)       | Basic        | Deploy a FrontMCP server to Cloudflare Workers with a minimal configuration.                            |
| [`worker-custom-domain`](../examples/deploy-to-cloudflare/worker-custom-domain.md)     | Advanced     | Scaffold a FrontMCP project targeting Cloudflare, configure a custom domain, and verify the deployment. |
| [`worker-with-kv-storage`](../examples/deploy-to-cloudflare/worker-with-kv-storage.md) | Intermediate | Deploy a FrontMCP server to Cloudflare Workers with KV namespace for session and state storage.         |

> See all examples in [`examples/deploy-to-cloudflare/`](../examples/deploy-to-cloudflare/)

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/deployment/serverless>
- **Related skills:** `build-for-cli`, `build-for-browser`, `build-for-sdk`
