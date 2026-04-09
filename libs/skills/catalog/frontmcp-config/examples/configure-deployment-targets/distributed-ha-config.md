---
name: distributed-ha-config
reference: configure-deployment-targets
level: advanced
description: Configure a distributed deployment target with HA settings for heartbeat, session takeover, and Redis-backed session persistence
tags: [config, deployment, distributed, ha, redis, heartbeat, session-takeover]
features:
  - Configuring the distributed deployment target with HA options
  - Setting custom heartbeat intervals and TTL for pod liveness detection
  - Combining server config (CSP, cookies) with HA config in the same target
  - Using per-target environment variables for Redis connection
---

# Distributed Deployment with HA Configuration

Configure a distributed deployment target with HA settings for heartbeat, session takeover, and Redis-backed session persistence

## Code

```typescript
// frontmcp.config.ts
import { defineConfig } from '@frontmcp/cli';

export default defineConfig({
  name: 'ha-server',
  version: '1.0.0',
  deployments: [
    // Development: standalone Node.js
    {
      target: 'node',
      server: { http: { port: 3000 } },
    },

    // Production: distributed with HA
    {
      target: 'distributed',
      ha: {
        heartbeatIntervalMs: 5000, // Write heartbeat every 5s (fast detection)
        heartbeatTtlMs: 15000, // 3x interval for TTL
        takeoverGracePeriodMs: 3000, // Wait 3s before claiming orphaned sessions
        redisKeyPrefix: 'mcp:ha:', // Default prefix for all HA keys
      },
      server: {
        http: { port: 8080 },
        cookies: {
          affinity: '__myapp_node', // Custom affinity cookie name
          sameSite: 'Lax',
        },
        csp: {
          enabled: true,
          directives: { 'default-src': "'self'" },
        },
      },
      env: {
        REDIS_HOST: 'redis.prod.internal',
        NODE_ENV: 'production',
      },
    },
  ],
});
```

### Build Both Targets

```bash
# Development
frontmcp build --target node

# Production
FRONTMCP_DEPLOYMENT_MODE=distributed frontmcp build --target distributed
```

### Server Code

```typescript
// src/main.ts
import { z } from 'zod';

import { App, FrontMcp, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'status', description: 'Server status', inputSchema: {} })
class StatusTool extends ToolContext {
  async execute() {
    return { status: 'healthy', timestamp: Date.now() };
  }
}

@App({ name: 'main', tools: [StatusTool] })
class MainApp {}

@FrontMcp({
  info: { name: 'ha-server', version: '1.0.0' },
  apps: [MainApp],
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] || 'localhost',
    port: 6379,
  },
  transport: {
    persistence: {
      redis: {
        provider: 'redis',
        host: process.env['REDIS_HOST'] || 'localhost',
        port: 6379,
      },
    },
  },
})
class Server {}
```

## What This Demonstrates

- Configuring the distributed deployment target with HA options
- Setting custom heartbeat intervals and TTL for pod liveness detection
- Combining server config (CSP, cookies) with HA config in the same target
- Using per-target environment variables for Redis connection

## Related

- See `configure-deployment-targets` for the full multi-target reference
- See `distributed-ha` for the HA architecture deep dive
- See `configure-security-headers` for full security headers setup
