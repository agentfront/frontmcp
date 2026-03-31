---
name: remote-enterprise-oauth
reference: configure-auth-modes
level: advanced
description: 'Delegate authentication to an external OAuth orchestrator with Redis-backed token storage.'
tags: [config, oauth, auth, redis, remote, auth-modes]
features:
  - "Using `mode: 'remote'` to delegate to an external OAuth 2.1 authorization server"
  - 'Loading `clientId` and `clientSecret` from environment variables (never hardcoded)'
  - 'Configuring Redis-backed token storage for production persistence'
  - 'Full OAuth flow: clients are redirected to the provider and return with an authorization code'
---

# Remote Enterprise OAuth

Delegate authentication to an external OAuth orchestrator with Redis-backed token storage.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'query_data',
  description: 'Query enterprise data warehouse',
  inputSchema: { sql: z.string() },
  outputSchema: { rows: z.array(z.record(z.string(), z.unknown())), rowCount: z.number() },
})
class QueryDataTool extends ToolContext {
  async execute(input: { sql: string }) {
    return { rows: [{ id: 1, name: 'example' }], rowCount: 1 };
  }
}

@App({
  name: 'enterprise-api',
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: process.env['OAUTH_CLIENT_ID']!,
    clientSecret: process.env['OAUTH_CLIENT_SECRET'],
    tokenStorage: 'redis',
  },
  tools: [QueryDataTool],
})
class EnterpriseApi {}

@FrontMcp({
  info: { name: 'enterprise-server', version: '1.0.0' },
  apps: [EnterpriseApi],
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] ?? 'redis.internal',
    port: Number(process.env['REDIS_PORT'] ?? 6379),
    password: process.env['REDIS_PASSWORD'],
  },
})
class Server {}
```

## What This Demonstrates

- Using `mode: 'remote'` to delegate to an external OAuth 2.1 authorization server
- Loading `clientId` and `clientSecret` from environment variables (never hardcoded)
- Configuring Redis-backed token storage for production persistence
- Full OAuth flow: clients are redirected to the provider and return with an authorization code

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `setup-redis` for Redis provisioning details
