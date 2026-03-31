---
name: vercel-kv-serverless
reference: setup-redis
level: intermediate
description: 'Configure a FrontMCP server with Vercel KV as the session store for serverless deployment.'
tags: [setup, vercel-kv, redis, vercel, session, transport]
features:
  - "`provider: 'vercel-kv'` for managed Redis-compatible storage on Vercel"
  - "`transport: { protocol: 'modern' }` required for Streamable HTTP on serverless"
  - 'Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` in production'
  - 'Explicit `url` and `token` fields for local testing outside Vercel'
---

# Vercel KV for Serverless Deployment

Configure a FrontMCP server with Vercel KV as the session store for serverless deployment.

## Code

```typescript
// src/main.ts
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-vercel-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  transport: { protocol: 'modern' },
  redis: {
    provider: 'vercel-kv',
    keyPrefix: 'mcp:',
    defaultTtlMs: 3600000,
  },
})
export default class Server {}
```

For testing Vercel KV locally with explicit credentials:

```typescript
// src/main.ts (local testing variant)
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-vercel-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  transport: { protocol: 'modern' },
  redis: {
    provider: 'vercel-kv',
    url: process.env['KV_REST_API_URL'],
    token: process.env['KV_REST_API_TOKEN'],
    keyPrefix: 'mcp:',
  },
})
export default class Server {}
```

```env
# .env.local (for local testing; Vercel auto-injects these in production)
KV_REST_API_URL=https://your-kv.kv.vercel-storage.com
KV_REST_API_TOKEN=your-token
```

## What This Demonstrates

- `provider: 'vercel-kv'` for managed Redis-compatible storage on Vercel
- `transport: { protocol: 'modern' }` required for Streamable HTTP on serverless
- Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` in production
- Explicit `url` and `token` fields for local testing outside Vercel

## Related

- See `setup-redis` for Docker provisioning and hybrid pub/sub with Vercel KV
