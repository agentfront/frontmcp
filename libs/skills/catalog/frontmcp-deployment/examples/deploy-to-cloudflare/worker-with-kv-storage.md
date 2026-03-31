---
name: worker-with-kv-storage
reference: deploy-to-cloudflare
level: intermediate
description: 'Deploy a FrontMCP server to Cloudflare Workers with KV namespace for session and state storage.'
tags: [deployment, cloudflare, cli, session, worker, kv]
features:
  - 'Binding a KV namespace in `wrangler.toml` with `[[kv_namespaces]]`'
  - 'Using `wrangler secret put` for sensitive values instead of `[vars]` (which are visible in plaintext)'
  - 'Creating the KV namespace via CLI and copying the ID into the configuration'
---

# Cloudflare Worker with KV Storage

Deploy a FrontMCP server to Cloudflare Workers with KV namespace for session and state storage.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'store_value',
  description: 'Store a value by key',
  inputSchema: { key: z.string(), value: z.string() },
})
class StoreValueTool extends ToolContext<{ key: string; value: string }> {
  async execute(input: { key: string; value: string }) {
    return {
      content: [{ type: 'text' as const, text: `Stored: ${input.key}` }],
    };
  }
}

@App({ name: 'StorageApp', tools: [StoreValueTool] })
class StorageApp {}

@FrontMcp({
  info: { name: 'my-worker', version: '1.0.0' },
  apps: [StorageApp],
  transport: {
    type: 'sse',
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

[[kv_namespaces]]
binding = "FRONTMCP_KV"
id = "your-kv-namespace-id"

[vars]
NODE_ENV = "production"
```

```bash
# Create the KV namespace
wrangler kv:namespace create FRONTMCP_KV
# Copy the returned id into wrangler.toml

# Store secrets securely (not in [vars])
wrangler secret put MY_API_KEY

# Build and deploy
frontmcp build --target cloudflare
wrangler deploy

# Verify
curl -X POST https://frontmcp-worker.your-subdomain.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## What This Demonstrates

- Binding a KV namespace in `wrangler.toml` with `[[kv_namespaces]]`
- Using `wrangler secret put` for sensitive values instead of `[vars]` (which are visible in plaintext)
- Creating the KV namespace via CLI and copying the ID into the configuration

## Related

- See `deploy-to-cloudflare` for D1, Durable Objects, bundle size limits, and storage comparison table
