---
name: redis-session-store
reference: configure-session
level: basic
description: 'Configure Redis-backed session storage for production deployments.'
tags: [config, redis, session, store]
features:
  - 'Configuring Redis as the session storage provider for production persistence'
  - 'Using `keyPrefix` to namespace session keys and prevent collisions with other servers'
  - 'Setting `defaultTtlMs` to control session lifetime (1 hour for interactive use)'
  - 'Loading Redis connection details from environment variables'
---

# Redis Session Store

Configure Redis-backed session storage for production deployments.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({ name: 'my-app' })
class MyApp {}

@FrontMcp({
  info: { name: 'prod-server', version: '1.0.0' },
  apps: [MyApp],
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: Number(process.env['REDIS_PORT'] ?? 6379),
    password: process.env['REDIS_PASSWORD'],
    keyPrefix: 'myapp-mcp:session:',
    defaultTtlMs: 3_600_000, // 1 hour for interactive sessions
  },
})
class Server {}
```

## What This Demonstrates

- Configuring Redis as the session storage provider for production persistence
- Using `keyPrefix` to namespace session keys and prevent collisions with other servers
- Setting `defaultTtlMs` to control session lifetime (1 hour for interactive use)
- Loading Redis connection details from environment variables

## Related

- See `configure-session` for all session storage options
- See `setup-redis` for Redis provisioning details
