---
name: vercel-with-skills-cache
reference: deploy-to-vercel
level: intermediate
description: 'Deploy a FrontMCP server to Vercel with skills enabled and KV-backed skill caching.'
tags: [deployment, vercel-kv, vercel, cache, security, skills]
features:
  - 'Enabling skills cache backed by Vercel KV with a 60-second TTL'
  - 'Setting environment variables via `vercel env add` instead of hardcoding in source'
  - 'Adding security headers (`X-Content-Type-Options`, `X-Frame-Options`) in `vercel.json`'
---

# Vercel Deployment with Skills Cache

Deploy a FrontMCP server to Vercel with skills enabled and KV-backed skill caching.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({ name: 'MyApp' })
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: { provider: 'vercel-kv' },
  skillsConfig: {
    enabled: true,
    cache: {
      enabled: true,
      redis: { provider: 'vercel-kv' },
      ttlMs: 60000,
    },
  },
})
class MyServer {}
```

```bash
# Set environment variables via Vercel CLI
vercel env add KV_REST_API_URL "https://your-kv-store.kv.vercel-storage.com"
vercel env add KV_REST_API_TOKEN "your-token"
vercel env add NODE_ENV production
vercel env add LOG_LEVEL info
```

```json
// vercel.json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/frontmcp" }],
  "functions": {
    "api/frontmcp.ts": {
      "memory": 1024,
      "maxDuration": 60
    }
  },
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

```bash
# Deploy to production
frontmcp build --target vercel
vercel --prod

# Add a custom domain
vercel domains add mcp.example.com
```

## What This Demonstrates

- Enabling skills cache backed by Vercel KV with a 60-second TTL
- Setting environment variables via `vercel env add` instead of hardcoding in source
- Adding security headers (`X-Content-Type-Options`, `X-Frame-Options`) in `vercel.json`

## Related

- See `deploy-to-vercel` for the full deployment guide including cold start notes and execution limits
