---
name: vercel-with-kv
reference: deploy-to-vercel
level: basic
description: 'Deploy a FrontMCP server to Vercel serverless functions with Vercel KV for session persistence.'
tags: [deployment, vercel-kv, vercel, session, performance, serverless]
features:
  - "Configuring `{ provider: 'vercel-kv' }` for automatic Vercel KV session storage"
  - 'The `vercel.json` catch-all rewrite that routes all requests to the single FrontMCP handler'
  - 'Setting function memory to 1024 MB for faster cold starts'
---

# Deploy to Vercel with KV Storage

Deploy a FrontMCP server to Vercel serverless functions with Vercel KV for session persistence.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'greet',
  description: 'Greet a user',
  inputSchema: { name: z.string() },
})
class GreetTool extends ToolContext<{ name: string }> {
  async execute(input: { name: string }) {
    return { content: [{ type: 'text' as const, text: `Hello, ${input.name}!` }] };
  }
}

@App({ name: 'MyApp', tools: [GreetTool] })
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: { provider: 'vercel-kv' },
})
class MyServer {}
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
  "regions": ["iad1"]
}
```

```bash
# Build for Vercel
frontmcp build --target vercel

# Preview deployment
vercel

# Production deployment
vercel --prod

# Verify
curl https://your-project.vercel.app/health
```

## What This Demonstrates

- Configuring `{ provider: 'vercel-kv' }` for automatic Vercel KV session storage
- The `vercel.json` catch-all rewrite that routes all requests to the single FrontMCP handler
- Setting function memory to 1024 MB for faster cold starts

## Related

- See `deploy-to-vercel` for KV provisioning, environment variables, and cold start optimization
