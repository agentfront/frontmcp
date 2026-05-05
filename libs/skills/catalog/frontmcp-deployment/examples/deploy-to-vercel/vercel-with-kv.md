---
name: vercel-with-kv
reference: deploy-to-vercel
level: basic
description: Deploy a FrontMCP server to Vercel serverless functions with Vercel KV for session persistence. The CLI emits the full Build Output API v3 structure for you — you do **not** author `api/frontmcp.ts` and you do **not** add a `rewrites` block.
tags:
  - deployment
  - vercel-kv
  - vercel
  - session
  - performance
  - serverless
features:
  - "Configuring `{ provider: 'vercel-kv' }` for automatic Vercel KV session storage"
  - Letting the CLI produce the Build Output API v3 structure (no manual `api/` directory or `rewrites`)
  - Deploying with `vercel --prod` after the build emits `.vercel/output/`
---

# Deploy to Vercel with KV Storage

Deploy a FrontMCP server to Vercel serverless functions with Vercel KV for session persistence. The CLI emits the full Build Output API v3 structure for you — you do **not** author `api/frontmcp.ts` and you do **not** add a `rewrites` block.

## Code

```typescript
// src/main.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'greet',
  description: 'Greet a user',
  inputSchema: { name: z.string() },
})
class GreetTool extends ToolContext {
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
export default class MyServer {}
```

```json
// vercel.json — written for you by `frontmcp build --target vercel`.
// buildCommand/installCommand are detected from your lockfile.
{
  "version": 2,
  "buildCommand": "yarn build",
  "installCommand": "yarn install"
}
```

```bash
# Build for Vercel — emits .vercel/output/functions/index.func/handler.cjs
# plus .vercel/output/config.json with the catch-all route.
frontmcp build --target vercel

# Preview deployment
vercel

# Production deployment
vercel --prod

# Verify (FrontMCP serves /healthz by default)
curl https://your-project.vercel.app/healthz
```

## What This Demonstrates

- Configuring `{ provider: 'vercel-kv' }` for automatic Vercel KV session storage
- Letting the CLI produce the Build Output API v3 structure (no manual `api/` directory or `rewrites`)
- Deploying with `vercel --prod` after the build emits `.vercel/output/`

## Related

- See `deploy-to-vercel` for KV provisioning, environment variables, and cold start optimization
