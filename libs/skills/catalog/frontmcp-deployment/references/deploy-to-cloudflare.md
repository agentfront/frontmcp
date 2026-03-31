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
dist/
  main.js      # Your compiled server (CommonJS)
  index.js     # Cloudflare handler wrapper
wrangler.toml  # Wrangler configuration
```

Cloudflare Workers use CommonJS (not ESM). The build command sets `--module commonjs` automatically.

## Step 3: Configure wrangler.toml

The generated `wrangler.toml`:

```toml
name = "frontmcp-worker"
main = "dist/index.js"
compatibility_date = "2024-01-01"

[vars]
NODE_ENV = "production"
```

To add KV storage for sessions and state:

```toml
name = "frontmcp-worker"
main = "dist/index.js"
compatibility_date = "2024-01-01"

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
import { FrontMcp, App } from '@frontmcp/sdk';

@App({ name: 'MyApp' })
class MyApp {}

@FrontMcp({
  info: { name: 'my-worker', version: '1.0.0' },
  apps: [MyApp],
  transport: {
    type: 'sse',
  },
})
class MyServer {}

export default MyServer;
```

For KV-backed session storage, use the Cloudflare KV or Upstash Redis provider.

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
# Health check
curl https://frontmcp-worker.your-subdomain.workers.dev/health

# Test MCP endpoint
curl -X POST https://frontmcp-worker.your-subdomain.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Workers Limitations

- **Bundle size**: Workers have a 1 MB compressed / 10 MB uncompressed limit (paid plan: 10 MB / 30 MB). Review dependencies and remove unused packages to reduce bundle size.
- **CPU time**: 10 ms CPU time on free plan, 30 seconds on paid. Long-running operations must be optimized or use Durable Objects.
- **No native modules**: `better-sqlite3` and other native Node.js modules are not available. Use KV, D1, or Upstash Redis for storage.
- **Streaming**: SSE streaming may have limitations through the Workers adapter. Test thoroughly.

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
| Module format errors          | `wrangler.toml` sets `type = "module"`         | Remove the `type` field; FrontMCP Cloudflare builds use CommonJS          |
| KV binding errors             | Namespace not created or binding name mismatch | Run `wrangler kv:namespace create` and copy the `id` into `wrangler.toml` |
| Timeout errors                | CPU time exceeds plan limit                    | Upgrade plan or offload heavy computation to Durable Objects              |
| CORS failures on MCP endpoint | Missing CORS headers in Worker response        | Add CORS middleware or headers in your FrontMCP server configuration      |

## Common Patterns

| Pattern            | Correct                                     | Incorrect                         | Why                                                |
| ------------------ | ------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| Module format      | CommonJS (`main = "dist/index.js"`)         | ESM (`type = "module"`)           | FrontMCP Cloudflare builds emit CommonJS           |
| Storage binding    | `[[kv_namespaces]]` with matching `binding` | Hardcoded KV namespace ID in code | Bindings are injected at runtime by Workers        |
| Compatibility date | Set to a recent, tested date                | Omitting `compatibility_date`     | Workers behavior changes across compat dates       |
| Build command      | `frontmcp build --target cloudflare`        | `frontmcp build` (no target)      | Default target is Node.js, not Workers             |
| Secrets            | `wrangler secret put MY_SECRET`             | Storing secrets in `[vars]`       | `[vars]` are visible in plaintext in the dashboard |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target cloudflare` completes without errors
- [ ] Bundle size is within Cloudflare plan limits (free: 1 MB compressed)

**Configuration**

- [ ] `wrangler.toml` has correct `name`, `main`, and `compatibility_date`
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
