---
name: wrangler-config
reference: production-cloudflare
level: basic
description: 'Shows how to configure `wrangler.toml` with correct routes, KV bindings for session storage, and secret management for a FrontMCP Cloudflare Worker.'
tags: [production, cloudflare, cache, session, wrangler, config]
features:
  - 'Complete `wrangler.toml` with KV bindings for sessions and cache'
  - 'Separate staging/production environment configs'
  - 'Cloudflare Worker entry point via `createCloudflareHandler`'
  - 'Secrets managed via `wrangler secret put` (not in config files)'
---

# Wrangler Configuration with KV Bindings

Shows how to configure `wrangler.toml` with correct routes, KV bindings for session storage, and secret management for a FrontMCP Cloudflare Worker.

## Code

```toml
# wrangler.toml
name = "my-mcp-worker"
main = "dist/worker.js"
compatibility_date = "2024-01-01"

# Custom domain routing
routes = [
  { pattern = "mcp.example.com/*", zone_name = "example.com" }
]

# KV namespace for session storage
[[kv_namespaces]]
binding = "MCP_SESSIONS"
id = "abc123def456"

# KV namespace for cache
[[kv_namespaces]]
binding = "MCP_CACHE"
id = "def456ghi789"

# Environment-specific config
[env.staging]
name = "my-mcp-worker-staging"
routes = [
  { pattern = "mcp-staging.example.com/*", zone_name = "example.com" }
]

[env.production]
name = "my-mcp-worker-production"
routes = [
  { pattern = "mcp.example.com/*", zone_name = "example.com" }
]
```

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'cf-mcp', version: '1.0.0' },
  apps: [MyApp],

  // CORS: use the workers.dev or custom domain
  cors: {
    origin: ['https://app.example.com'],
  },
})
export default class CloudflareMcpServer {}
```

```typescript
// src/worker.ts — Cloudflare Worker entry point
import { createCloudflareHandler } from '@frontmcp/adapters/cloudflare';
import Server from './main';

export default createCloudflareHandler(Server);
```

## What This Demonstrates

- Complete `wrangler.toml` with KV bindings for sessions and cache
- Separate staging/production environment configs
- Cloudflare Worker entry point via `createCloudflareHandler`
- Secrets managed via `wrangler secret put` (not in config files)

## Related

- See `production-cloudflare` for the full Cloudflare Workers checklist
