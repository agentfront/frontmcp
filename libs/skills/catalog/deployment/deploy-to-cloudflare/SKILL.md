---
name: deploy-to-cloudflare
description: Deploy a FrontMCP server to Cloudflare Workers. Use when deploying to Cloudflare, configuring wrangler.toml, or setting up Workers KV storage.
tags:
  - deployment
  - cloudflare
  - workers
  - serverless
parameters:
  - name: worker-name
    description: Name for the Cloudflare Worker
    type: string
    required: false
    default: frontmcp-worker
  - name: kv-namespace
    description: KV namespace binding name for session and state storage
    type: string
    required: false
  - name: compatibility-date
    description: Cloudflare Workers compatibility date
    type: string
    required: false
    default: '2024-01-01'
examples:
  - scenario: Deploy a basic MCP server to Cloudflare Workers
    parameters:
      worker-name: my-mcp-worker
    expectedOutcome: A FrontMCP server running as a Cloudflare Worker with wrangler.toml configured and deployed via wrangler deploy.
  - scenario: Deploy with Workers KV for persistent storage
    parameters:
      worker-name: my-mcp-worker
      kv-namespace: FRONTMCP_KV
    expectedOutcome: A FrontMCP server with Cloudflare KV providing persistent storage for sessions and skill state.
compatibility: Wrangler CLI required. Cloudflare Workers support is experimental.
license: Apache-2.0
visibility: both
priority: 10
metadata:
  category: deployment
  difficulty: intermediate
  platform: cloudflare
  docs: https://docs.agentfront.dev/frontmcp/deployment/serverless
---

# Deploy a FrontMCP Server to Cloudflare Workers

This skill guides you through deploying a FrontMCP server to Cloudflare Workers.

<Warning>
Cloudflare Workers support is **experimental**. The Express-to-Workers adapter has limitations with streaming, certain middleware, and some response methods. For production Cloudflare deployments, consider using Hono or native Workers APIs.
</Warning>

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

```
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

@App()
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

- **Bundle size**: Workers have a 1 MB compressed / 10 MB uncompressed limit (paid plan: 10 MB / 30 MB). Use `frontmcp build --target cloudflare --analyze` to inspect the bundle.
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

- **Worker exceeds size limit**: Minimize dependencies. Run `frontmcp build --target cloudflare --analyze` and remove unused packages.
- **Module format errors**: Ensure `wrangler.toml` does not set `type = "module"`. FrontMCP Cloudflare builds use CommonJS.
- **KV binding errors**: Verify the KV namespace is created and the binding name in `wrangler.toml` matches your code.
- **Timeout errors**: Check CPU time limits for your Cloudflare plan. Optimize or offload heavy computation.
