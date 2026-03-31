---
name: multi-server-key-prefix
reference: configure-session
level: intermediate
description: 'Use unique key prefixes when multiple FrontMCP servers share one Redis instance.'
tags: [config, redis, session, multi, key, prefix]
features:
  - 'Using unique `keyPrefix` values per server to avoid session key collisions'
  - 'Both servers share the same Redis instance but have isolated session namespaces'
  - 'Tuning `defaultTtlMs` per server based on workload pattern'
  - '`billing-mcp:session:` vs `analytics-mcp:session:` prevents cross-contamination'
---

# Multi-Server Key Prefix Isolation

Use unique key prefixes when multiple FrontMCP servers share one Redis instance.

## Code

```typescript
// src/billing-server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({ name: 'billing-app' })
class BillingApp {}

@FrontMcp({
  info: { name: 'billing-server', version: '1.0.0' },
  apps: [BillingApp],
  redis: {
    provider: 'redis',
    host: 'shared-redis.internal',
    port: 6379,
    keyPrefix: 'billing-mcp:session:',
    defaultTtlMs: 86_400_000, // 24 hours for long-running agent workflows
  },
})
class BillingServer {}

// src/analytics-server.ts
@App({ name: 'analytics-app' })
class AnalyticsApp {}

@FrontMcp({
  info: { name: 'analytics-server', version: '1.0.0' },
  apps: [AnalyticsApp],
  redis: {
    provider: 'redis',
    host: 'shared-redis.internal',
    port: 6379,
    keyPrefix: 'analytics-mcp:session:',
    defaultTtlMs: 600_000, // 10 minutes for short CI/CD operations
  },
})
class AnalyticsServer {}
```

## What This Demonstrates

- Using unique `keyPrefix` values per server to avoid session key collisions
- Both servers share the same Redis instance but have isolated session namespaces
- Tuning `defaultTtlMs` per server based on workload pattern
- `billing-mcp:session:` vs `analytics-mcp:session:` prevents cross-contamination

## Related

- See `configure-session` for the full session configuration reference
- See `setup-redis` for Redis provisioning details
