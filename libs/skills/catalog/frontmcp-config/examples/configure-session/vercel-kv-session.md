---
name: vercel-kv-session
reference: configure-session
level: intermediate
description: 'Configure Vercel KV for session storage in serverless Vercel deployments.'
tags: [config, vercel-kv, vercel, session, transport, serverless]
features:
  - "Using `provider: 'vercel-kv'` for Vercel platform deployments"
  - 'Vercel automatically injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables'
  - 'Combining with `stateless-api` transport preset for serverless execution'
  - 'No explicit host/port needed -- Vercel KV uses REST API under the hood'
---

# Vercel KV Session Store

Configure Vercel KV for session storage in serverless Vercel deployments.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({ name: 'my-app' })
class MyApp {}

@FrontMcp({
  info: { name: 'vercel-server', version: '1.0.0' },
  apps: [MyApp],
  redis: {
    provider: 'vercel-kv',
    // KV_REST_API_URL and KV_REST_API_TOKEN are auto-injected by Vercel
  },
  transport: {
    protocol: 'stateless-api',
    sessionMode: 'stateless',
  },
})
class Server {}
```

## What This Demonstrates

- Using `provider: 'vercel-kv'` for Vercel platform deployments
- Vercel automatically injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables
- Combining with `stateless-api` transport preset for serverless execution
- No explicit host/port needed -- Vercel KV uses REST API under the hood

## Related

- See `configure-session` for all session storage options
- See `configure-transport` for transport protocol configuration
