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
- Wrangler — `frontmcp create --target cloudflare` adds it as a devDependency, so `npm run deploy` / `npm run dev:worker` use the project-local version. Invoke it directly as `npx wrangler` rather than installing it globally, so the pinned version is the one that runs.
- A built FrontMCP project

## Step 1: Create a Cloudflare-targeted Project

```bash
npx frontmcp create my-app --target cloudflare
```

This generates the project with a `wrangler.toml`, `wrangler` as a devDependency, and `deploy` / `dev:worker` scripts that build first and then run the project-local `wrangler`.

## Step 2: Build for Cloudflare

```bash
frontmcp build --target cloudflare
```

This produces:

```text
dist/cloudflare/
  index.js       # Cloudflare Workers entry (ES Module / Module Worker) — wraps your @FrontMcp server
  main.js        # Your compiled server module (ES Module)
wrangler.toml    # Wrangler configuration (managed keys reconciled on every build)
```

The adapter emits a **Module Worker** (`export default { fetch }`), so the build
compiles with `--module esnext`. The legacy CommonJS `module.exports` shape is
read by Cloudflare as a Service Worker, where `nodejs_compat` cannot externalize
Node builtins and the deploy fails — do not force CommonJS for this target.

> **Important:** The Cloudflare adapter sets `alwaysWriteConfig: true`, but it rewrites only the keys it manages. `main` is always overwritten (it has to track the build output); `name` and `compatibility_date` are written only when the file does not already declare them; `compatibility_flags` is merged. Hand-edited `[vars]`, `[[kv_namespaces]]`, `[[d1_databases]]`, `[triggers]` and comments survive every build. If `wrangler.toml` and `frontmcp.config` disagree on the worker name, the build keeps the file's value and warns instead of renaming your worker.

## Step 3: Configure wrangler.toml

The build writes this when the file does not exist yet. `nodejs_compat` is **always** emitted — the worker entry is an ES Module that imports `@frontmcp/sdk`'s web-fetch handler, which still transitively pulls in Node builtins (no Express on the Worker), so without the flag the deployed Worker fails to load. `nodejs_compat_populate_process_env` is emitted too, so `[vars]` and secrets are readable as `process.env.*`; add `nodejs_compat_do_not_populate_process_env` to `wrangler.compatibilityFlags` to opt out. The default `compatibility_date` is `2024-09-23` (the date that enables full `nodejs_compat`). `main` is `dist/cloudflare/index.js`.

```toml
name = "frontmcp-worker"
main = "dist/cloudflare/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat", "nodejs_compat_populate_process_env"]
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

To add KV storage or other bindings, add them to `wrangler.toml` directly — they are preserved across builds:

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
npx wrangler kv:namespace create FRONTMCP_KV
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

### Secrets, vars and `process.env`

Worker bindings arrive as an argument to `fetch`, not as environment variables. The generated entry copies every **string** binding into `process.env` on the first request (existing values are never overwritten), so ordinary `process.env.MY_API_KEY` reads behave the same on Workers as under `frontmcp dev`. Non-string bindings (KV, D1, R2, Durable Objects) stay on `env`, which the entry forwards to the handler along with `ctx`.

A value read at module-eval time — inside the `@FrontMcp({...})` argument itself — is still `undefined`, because the copy happens on the first request. Read configuration inside `execute()` / `read()`, or rely on `nodejs_compat_populate_process_env` (emitted by default), which populates `process.env` before your module evaluates.

### Required secrets

`NODE_ENV = "production"` in `[vars]` makes this a production deployment, where FrontMCP refuses its development fallbacks:

| Secret | Required when | Failure without it |
| ------ | ------------- | ------------------ |
| `MCP_SESSION_SECRET` | always in production — `session:verify` encrypts session IDs with it | `500 {"error":"server_misconfigured","code":"SESSION_SECRET_REQUIRED"}` |
| `JWT_SECRET` | `auth.mode` is `local` or `remote` (these mint tokens) | the server refuses to start; requests answer `500 {"error":"server_misconfigured","code":"JWT_SECRET_REQUIRED"}` |

```bash
npx wrangler secret put MCP_SESSION_SECRET   # openssl rand -hex 32
npx wrangler secret put JWT_SECRET           # openssl rand -hex 32
```

Because `[vars]` reach `process.env`, `npx wrangler dev` sees the same `NODE_ENV=production` the deployment does, so a missing secret fails locally rather than only after a successful deploy.

### Background tasks

Background tasks need a store that outlives a single request and is shared between isolates, which an edge runtime cannot provide in-process. FrontMCP disables them automatically when no distributed store is configured, and the worker serves normally without them — no `tasks: { enabled: false }` opt-out is needed. `tasks: { enabled: true }` without `tasks.redis` fails the build rather than the deployed worker.

## Step 5: Deploy

```bash
# Preview deployment
npx wrangler dev

# Production deployment
npx wrangler deploy
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

Two settings name this concept. `transport.http.path` in `frontmcp.config.*` configures the **CLI** (`frontmcp dev`, the inspector, the generated `clients[].url`); `@FrontMcp({ http: { entryPath } })` configures the **server**, and that is what the deployed worker reads. The cloudflare build reconciles them — `transport.http.path` becomes the server's default, an explicit decorator `entryPath` still wins, and the build warns on a mismatch and prints the resolved path (`Server will serve MCP at /mcp`).

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
- **Streaming**: Streamable HTTP works, including SSE responses (`POST` with `Accept: text/event-stream`) and the server→client SSE `GET` stream. The worker uses the SDK's `WebStandardStreamableHTTPServerTransport` — which **is** the standard Streamable HTTP transport (the Node `StreamableHTTPServerTransport` is a thin `req`/`res` wrapper over it, so there's one engine). **Server→client notifications** on the standalone `GET` stream require **stateful sessions** — set `sessions: {}` and bind the `SessionDurableObject` (Durable Object) per `Mcp-Session-Id`. Without it the worker is stateless and the `GET` stream can't deliver pushed notifications.

### Stateful sessions (Durable Object)

```ts
const mcp = createEdgeMcp({ /* …info, apps… */ http: { entryPath: '/mcp' }, sessions: {} });
export default mcp;
export const FrontMcpSession = mcp.SessionDurableObject;
```

```toml
[[durable_objects.bindings]]
name = "FRONTMCP_SESSIONS"
class_name = "FrontMcpSession"
[[migrations]]
tag = "v1"
new_classes = ["FrontMcpSession"]
# MCP_SESSION_SECRET is required on production isolates. Set it as a SECRET, not
# a var — `[vars]` is committed plaintext:
#   npx wrangler secret put MCP_SESSION_SECRET   # openssl rand -hex 32
```

One DO per session holds a persistent transport so the `GET` notification stream stays open and `tools/call` notifications reach it. It runs the **same `http:request` flow** (auth/session:verify/router/audit/metrics + hooks) as the stateless path — so transparent auth returns `401` + `WWW-Authenticate` on the worker too.

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

- [ ] `npx wrangler dev` serves the MCP endpoint locally
- [ ] `npx wrangler deploy` succeeds without errors
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
