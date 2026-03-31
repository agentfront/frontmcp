---
name: distributed-sessions-redis
reference: configure-transport
level: intermediate
description: 'Configure transport with Redis persistence for multi-instance load-balanced deployments.'
tags: [config, redis, session, transport, distributed, sessions]
features:
  - 'Using `distributedMode: true` for load-balanced multi-instance deployments'
  - 'Redis `persistence` so sessions survive restarts and are shared across instances'
  - 'Setting `defaultTtlMs` to prevent sessions from accumulating indefinitely'
  - 'Redis-backed `eventStore` for SSE resumability across instances'
  - "Using the `'modern'` preset (drops legacy SSE but keeps streamable HTTP)"
---

# Distributed Sessions with Redis

Configure transport with Redis persistence for multi-instance load-balanced deployments.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'get_report',
  description: 'Generate a report',
  inputSchema: { reportId: z.string() },
  outputSchema: { data: z.string(), generatedAt: z.string() },
})
class GetReportTool extends ToolContext {
  async execute(input: { reportId: string }) {
    return { data: 'report-data', generatedAt: new Date().toISOString() };
  }
}

@App({
  name: 'reports',
  tools: [GetReportTool],
})
class ReportsApp {}

@FrontMcp({
  info: { name: 'distributed-server', version: '1.0.0' },
  apps: [ReportsApp],
  transport: {
    sessionMode: 'stateful',
    protocol: 'modern',
    distributedMode: true,
    persistence: {
      redis: {
        provider: 'redis',
        host: process.env['REDIS_HOST'] ?? 'redis.internal',
        port: 6379,
      },
      defaultTtlMs: 3_600_000, // 1 hour session TTL
    },
    eventStore: {
      enabled: true,
      provider: 'redis',
      maxEvents: 10000,
      ttlMs: 300_000, // 5 minute event TTL
      redis: {
        provider: 'redis',
        host: process.env['REDIS_HOST'] ?? 'redis.internal',
      },
    },
  },
})
class Server {}
```

## What This Demonstrates

- Using `distributedMode: true` for load-balanced multi-instance deployments
- Redis `persistence` so sessions survive restarts and are shared across instances
- Setting `defaultTtlMs` to prevent sessions from accumulating indefinitely
- Redis-backed `eventStore` for SSE resumability across instances
- Using the `'modern'` preset (drops legacy SSE but keeps streamable HTTP)

## Related

- See `configure-transport` for the full transport configuration reference
- See `configure-session` for session storage options
- See `setup-redis` for Redis provisioning
