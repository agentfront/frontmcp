---
name: full-guard-config
reference: configure-throttle-guard-config
level: advanced
description: 'Complete GuardConfig using every available field for maximum protection.'
tags: [config, redis, session, throttle, guard, full]
features:
  - 'Every field in the `GuardConfig` interface used together'
  - 'Priority order: IP filter -> global rate limit -> global concurrency -> per-tool limits'
  - 'Redis `storage` for shared counters across instances'
  - '`keyPrefix` to namespace guard keys in shared Redis'
  - "Mixed `partitionBy` strategies: `'ip'` for global, `'session'` for per-tool"
  - '`queueTimeoutMs` to briefly queue excess requests instead of rejecting'
---

# Full GuardConfig with All Options

Complete GuardConfig using every available field for maximum protection.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';

@App({ name: 'secure-app' })
class SecureApp {}

@FrontMcp({
  info: { name: 'fully-guarded-server', version: '1.0.0' },
  apps: [SecureApp],
  throttle: {
    enabled: true,

    // Distributed storage for multi-instance deployments
    storage: {
      type: 'redis',
      redis: {
        config: {
          host: process.env['REDIS_HOST'] ?? 'redis.internal',
          port: 6379,
        },
      },
    },
    keyPrefix: 'myapp:guard:',

    // Server-wide limits
    global: {
      maxRequests: 1000,
      windowMs: 60000,
      partitionBy: 'ip', // per-client IP rate limit
    },
    globalConcurrency: {
      maxConcurrent: 50,
      queueTimeoutMs: 2000,
      partitionBy: 'global',
    },

    // Default per-tool limits
    defaultRateLimit: {
      maxRequests: 100,
      windowMs: 60000,
      partitionBy: 'session',
    },
    defaultConcurrency: {
      maxConcurrent: 10,
      queueTimeoutMs: 5000,
      partitionBy: 'session',
    },
    defaultTimeout: {
      executeMs: 30000,
    },

    // IP-based access control
    ipFilter: {
      allowList: ['10.0.0.0/8', '172.16.0.0/12'],
      denyList: ['192.168.1.100'],
      defaultAction: 'deny',
      trustProxy: true,
      trustedProxyDepth: 2,
    },
  },
})
class Server {}
```

## What This Demonstrates

- Every field in the `GuardConfig` interface used together
- Priority order: IP filter -> global rate limit -> global concurrency -> per-tool limits
- Redis `storage` for shared counters across instances
- `keyPrefix` to namespace guard keys in shared Redis
- Mixed `partitionBy` strategies: `'ip'` for global, `'session'` for per-tool
- `queueTimeoutMs` to briefly queue excess requests instead of rejecting

## Related

- See `configure-throttle-guard-config` for the complete interface reference
- See `configure-throttle` for practical throttle configuration patterns
