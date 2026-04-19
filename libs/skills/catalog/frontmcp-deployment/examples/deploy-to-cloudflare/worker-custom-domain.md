---
name: worker-custom-domain
reference: deploy-to-cloudflare
level: advanced
description: 'Scaffold a FrontMCP project targeting Cloudflare, configure a custom domain, and verify the deployment.'
tags: [deployment, json-rpc, cloudflare, worker, custom, domain]
features:
  - 'Using `frontmcp create --target cloudflare` to scaffold a project with `wrangler.toml` and deploy scripts'
  - 'Adding a custom domain with `wrangler domains add` for production-ready URLs'
  - 'End-to-end verification of both the health check and MCP JSON-RPC endpoint'
---

# Cloudflare Worker with Custom Domain and Project Scaffold

Scaffold a FrontMCP project targeting Cloudflare, configure a custom domain, and verify the deployment.

## Code

```bash
# Scaffold a new project targeting Cloudflare
npx frontmcp create my-app --target cloudflare
cd my-app
```

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'translate',
  description: 'Translate text',
  inputSchema: { text: z.string(), lang: z.string() },
})
class TranslateTool extends ToolContext<{ text: string; lang: string }> {
  async execute(input: { text: string; lang: string }) {
    return {
      content: [{ type: 'text' as const, text: `[${input.lang}] ${input.text}` }],
    };
  }
}

@App({ name: 'TranslateApp', tools: [TranslateTool] })
class TranslateApp {}

@FrontMcp({
  info: { name: 'translate-worker', version: '1.0.0' },
  apps: [TranslateApp],
  transport: {
    type: 'sse',
  },
})
class TranslateServer {}

export default TranslateServer;
```

```toml
# wrangler.toml
name = "translate-worker"
main = "dist/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "FRONTMCP_KV"
id = "your-kv-namespace-id"

[vars]
NODE_ENV = "production"
```

```bash
# Build and deploy
frontmcp build --target cloudflare
wrangler deploy

# Add a custom domain
wrangler domains add mcp.example.com

# Verify health endpoint
curl https://mcp.example.com/health

# Test MCP endpoint
curl -X POST https://mcp.example.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## What This Demonstrates

- Using `frontmcp create --target cloudflare` to scaffold a project with `wrangler.toml` and deploy scripts
- Adding a custom domain with `wrangler domains add` for production-ready URLs
- End-to-end verification of both the health check and MCP JSON-RPC endpoint

## Related

- See `deploy-to-cloudflare` for bundle size limits, CPU time constraints, and the full storage options table
