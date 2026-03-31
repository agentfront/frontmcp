---
name: vercel-edge-config
reference: production-vercel
level: basic
description: 'Shows how to configure a FrontMCP server for Vercel deployment with Vercel KV for session storage and correct route configuration.'
tags: [production, vercel-kv, vercel, session, serverless, edge]
features:
  - 'Correct `vercel.json` with function routes, memory limits, and max duration'
  - "Using Vercel KV (`provider: 'vercel-kv'`) for session storage instead of in-memory"
  - 'Setting CORS origins dynamically using `VERCEL_URL`'
  - 'Serverless function entry point via `createVercelHandler`'
---

# Vercel Configuration with Edge-Compatible Storage

Shows how to configure a FrontMCP server for Vercel deployment with Vercel KV for session storage and correct route configuration.

## Code

```jsonc
// vercel.json
{
  "version": 2,
  "builds": [{ "src": "api/**/*.ts", "use": "@vercel/node" }],
  "routes": [{ "src": "/mcp/(.*)", "dest": "/api/mcp" }],
  "functions": {
    "api/mcp.ts": {
      "memory": 256,
      "maxDuration": 30,
    },
  },
}
```

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'vercel-mcp', version: '1.0.0' },
  apps: [MyApp],

  // Vercel KV for session storage (not in-memory, not Redis directly)
  redis: {
    provider: 'vercel-kv', // Uses Vercel KV (Redis-compatible, managed)
  },

  // CORS: use VERCEL_URL or custom domain
  cors: {
    origin: [
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000',
      'https://app.example.com',
    ],
  },
})
export default class VercelMcpServer {}
```

```typescript
// api/mcp.ts — Vercel serverless function entry point
import { createVercelHandler } from '@frontmcp/adapters/vercel';
import Server from '../src/main';

export default createVercelHandler(Server);
```

## What This Demonstrates

- Correct `vercel.json` with function routes, memory limits, and max duration
- Using Vercel KV (`provider: 'vercel-kv'`) for session storage instead of in-memory
- Setting CORS origins dynamically using `VERCEL_URL`
- Serverless function entry point via `createVercelHandler`

## Related

- See `production-vercel` for the full Vercel deployment checklist
