---
name: vercel-serverless-server
reference: setup-project
level: intermediate
description: 'Configure a FrontMCP server for Vercel deployment with Vercel KV storage and modern transport protocol.'
tags: [setup, vercel-kv, redis, vercel, session, transport]
features:
  - "`transport: { protocol: 'modern' }` for streamable HTTP with strict sessions on Vercel"
  - "`redis: { provider: 'vercel-kv' }` for managed Redis-compatible storage without external provisioning"
  - 'Building with `frontmcp build --target vercel` for serverless output'
  - 'Vercel KV credentials are auto-injected via environment variables'
---

# Vercel Serverless Deployment Setup

Configure a FrontMCP server for Vercel deployment with Vercel KV storage and modern transport protocol.

## Code

```typescript
// src/tools/lookup-user.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'lookup_user',
  description: 'Look up a user by email',
  inputSchema: { email: z.string().email() },
})
export default class LookupUserTool extends ToolContext {
  async execute(input: { email: string }) {
    return { content: [{ type: 'text', text: `User: ${input.email}` }] };
  }
}
```

```typescript
// src/apps/users.app.ts
import { App } from '@frontmcp/sdk';

import LookupUserTool from '../tools/lookup-user.tool';

@App({
  name: 'Users',
  tools: [LookupUserTool],
})
export class UsersApp {}
```

```typescript
// src/main.ts
import 'reflect-metadata';

import { FrontMcp } from '@frontmcp/sdk';

import { UsersApp } from './apps/users.app';

@FrontMcp({
  info: { name: 'my-vercel-server', version: '0.1.0' },
  apps: [UsersApp],
  transport: { protocol: 'modern' },
  redis: { provider: 'vercel-kv' },
})
export default class Server {}
```

Build and deploy:

```bash
# Build for Vercel target
frontmcp build --target vercel

# Deploy
vercel deploy --prebuilt
```

```env
# .env.local (Vercel auto-injects KV_REST_API_URL and KV_REST_API_TOKEN)
# No manual Redis config needed for Vercel KV
```

## What This Demonstrates

- `transport: { protocol: 'modern' }` for streamable HTTP with strict sessions on Vercel
- `redis: { provider: 'vercel-kv' }` for managed Redis-compatible storage without external provisioning
- Building with `frontmcp build --target vercel` for serverless output
- Vercel KV credentials are auto-injected via environment variables

## Related

- See `setup-project` for all deployment target configurations (Lambda, Cloudflare)
- See `setup-redis` for detailed Vercel KV setup and hybrid pub/sub configuration
