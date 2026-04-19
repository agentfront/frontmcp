---
name: basic-worker-deploy
reference: deploy-to-cloudflare
level: basic
description: 'Deploy a FrontMCP server to Cloudflare Workers with a minimal configuration.'
tags: [deployment, cloudflare, transport, local, worker]
features:
  - 'A minimal FrontMCP server configured for Cloudflare Workers with SSE transport'
  - 'The `wrangler.toml` configuration with `main` pointing to the build output'
  - 'Using `wrangler dev` for local testing before deploying with `wrangler deploy`'
---

# Basic Cloudflare Workers Deployment

Deploy a FrontMCP server to Cloudflare Workers with a minimal configuration.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'echo',
  description: 'Echo back the input',
  inputSchema: { message: z.string() },
})
class EchoTool extends ToolContext<{ message: string }> {
  async execute(input: { message: string }) {
    return { content: [{ type: 'text' as const, text: input.message }] };
  }
}

@App({ name: 'MyApp', tools: [EchoTool] })
class MyApp {}

@FrontMcp({
  info: { name: 'my-worker', version: '1.0.0' },
  apps: [MyApp],
  transport: {
    protocol: 'legacy',
  },
})
class MyServer {}

export default MyServer;
```

```toml
# wrangler.toml
name = "frontmcp-worker"
main = "dist/index.js"
compatibility_date = "2024-01-01"

[vars]
NODE_ENV = "production"
```

```bash
# Build for Cloudflare Workers
frontmcp build --target cloudflare

# Preview locally
wrangler dev

# Deploy to production
wrangler deploy

# Verify
curl https://frontmcp-worker.your-subdomain.workers.dev/health
```

## What This Demonstrates

- A minimal FrontMCP server configured for Cloudflare Workers with SSE transport
- The `wrangler.toml` configuration with `main` pointing to the build output
- Using `wrangler dev` for local testing before deploying with `wrangler deploy`

## Related

- See `deploy-to-cloudflare` for KV storage, D1, bundle size limits, and troubleshooting
