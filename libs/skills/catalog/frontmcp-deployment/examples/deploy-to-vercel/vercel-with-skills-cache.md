---
name: vercel-with-skills-cache
reference: deploy-to-vercel
level: intermediate
description: 'Deploy a FrontMCP server to Vercel with skills enabled and KV-backed skill caching.'
tags: [deployment, vercel-kv, vercel, cache, skills]
features:
  - 'Enabling skills cache backed by Vercel KV with a 60-second TTL'
  - 'Setting environment variables via `vercel env add` instead of hardcoding in source'
  - 'Letting `frontmcp build --target vercel` emit the Build Output API v3 structure'
---

# Vercel Deployment with Skills Cache

Deploy a FrontMCP server to Vercel with skills enabled and KV-backed skill caching. The CLI handles the Build Output API v3 emission for you — your job is to configure the server and provision Vercel KV.

## Code

```typescript
// src/main.ts
import { App, FrontMcp } from '@frontmcp/sdk';

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
export default class MyServer {}
```

```bash
# Set environment variables via Vercel CLI (or link KV in the dashboard
# to inject KV_REST_API_URL/KV_REST_API_TOKEN automatically)
vercel env add KV_REST_API_URL "https://your-kv-store.kv.vercel-storage.com"
vercel env add KV_REST_API_TOKEN "your-token"
vercel env add NODE_ENV production
vercel env add LOG_LEVEL info
```

```json
// vercel.json — written by `frontmcp build --target vercel` from your lockfile.
// Do not add functions/rewrites referencing api/frontmcp.* (no such file).
{
  "version": 2,
  "buildCommand": "yarn build",
  "installCommand": "yarn install"
}
```

```bash
# Build, then deploy to production
frontmcp build --target vercel
vercel --prod

# Add a custom domain
vercel domains add mcp.example.com
```

## What This Demonstrates

- Enabling skills cache backed by Vercel KV with a 60-second TTL
- Setting environment variables via `vercel env add` instead of hardcoding in source
- Letting the CLI emit the Build Output API v3 structure rather than hand-authoring `api/frontmcp.ts`

## Related

- See `deploy-to-vercel` for the full deployment guide including cold start notes and execution limits
