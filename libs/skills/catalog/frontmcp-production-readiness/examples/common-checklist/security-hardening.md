---
name: security-hardening
reference: common-checklist
level: basic
description: 'Shows how to configure authentication, CORS, input validation, and rate limiting for a production FrontMCP server.'
tags: [production, redis, session, security, throttle, checklist]
features:
  - "Restricting CORS origins to known domains instead of using `'*'`"
  - 'Configuring rate limiting via the `throttle` option'
  - 'Using Redis for session storage in multi-instance deployments'
  - 'Defining both `inputSchema` and `outputSchema` on tools to prevent data leaks'
---

# Security Hardening Configuration

Shows how to configure authentication, CORS, input validation, and rate limiting for a production FrontMCP server.

## Code

```typescript
// src/main.ts
import { FrontMcp, z } from '@frontmcp/sdk';

import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'secure-server', version: '1.0.0' },
  apps: [MyApp],

  // Authentication: use remote OAuth provider
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: process.env.AUTH_CLIENT_ID!,
  },

  // CORS: restrict to known origins (never use '*' in production)
  cors: {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    credentials: true,
    maxAge: 86400, // Cache preflight for 24 hours
  },

  // Rate limiting: prevent abuse
  throttle: {
    windowMs: 60_000, // 1 minute window
    max: 100, // 100 requests per window per client
  },

  // Session storage: use Redis (not in-memory) for multi-instance
  redis: {
    provider: 'redis',
    host: process.env.REDIS_HOST ?? 'localhost',
    port: 6379,
  },
})
export default class SecureServer {}
```

```typescript
// src/tools/safe-query.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'safe_query',
  description: 'Query data with validated and sanitized input',
  inputSchema: {
    query: z.string().min(1).max(500).describe('Search query'),
    limit: z.number().int().min(1).max(100).default(10).describe('Max results'),
  },
  outputSchema: {
    results: z.array(z.object({ id: z.string(), title: z.string() })),
    total: z.number(),
  },
})
export class SafeQueryTool extends ToolContext {
  async execute(input: { query: string; limit: number }) {
    // Zod already validated input — safe to use
    // outputSchema prevents accidental data leaks
    return { results: [], total: 0 };
  }
}
```

## What This Demonstrates

- Restricting CORS origins to known domains instead of using `'*'`
- Configuring rate limiting via the `throttle` option
- Using Redis for session storage in multi-instance deployments
- Defining both `inputSchema` and `outputSchema` on tools to prevent data leaks

## Related

- See `common-checklist` for the full security, performance, and reliability checklist
