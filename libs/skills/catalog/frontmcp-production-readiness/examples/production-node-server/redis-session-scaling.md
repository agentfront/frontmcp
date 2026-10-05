---
name: redis-session-scaling
reference: production-node-server
level: advanced
description: 'Shows how to configure Redis-backed session storage, connection pooling, and stateless server design for horizontal scaling behind a load balancer.'
tags: [production, redis, session, node, scaling]
features:
  - 'Configuring Redis for session storage so all instances share state'
  - 'Using key prefixes to namespace Redis keys and avoid collisions'
  - 'Setting session TTL to prevent unbounded storage growth'
  - 'Configuring Redis-backed job store for multi-instance job processing'
  - 'Validating required environment variables at startup (fail fast)'
---

# Redis Session Storage for Multi-Instance Scaling

Shows how to configure Redis-backed session storage, connection pooling, and stateless server design for horizontal scaling behind a load balancer.

## Code

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'scalable-server', version: '1.0.0' },
  apps: [MyApp],

  // Redis for all shared state — sessions, cache, jobs
  redis: {
    provider: 'redis',
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
    keyPrefix: 'mcp:', // Namespace keys to avoid collisions
  },

  // Session storage: persistence without its own `redis` block reuses the top-level redis
  transport: {
    persistence: {
      defaultTtlMs: 3_600_000, // 1 hour session TTL
    },
  },

  // Jobs use Redis store for multi-instance consistency
  jobs: {
    enabled: true,
    store: {
      redis: {
        provider: 'redis',
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    },
    // Retry policy is per job: @Job({ retry: { maxAttempts: 3, maxBackoffMs: 30_000 } })
  },
})
export default class ScalableServer {}
```

```typescript
// src/providers/env-validation.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

// Validate env in the constructor rather than a lifecycle hook — first
// instantiation throws synchronously on missing config and prevents the
// server from starting (fail fast). Providers don't expose onInit/onDestroy.
// The class is its own DI token: list it in `providers` and resolve it with `this.get(EnvValidationProvider)`
@Provider({ name: 'EnvValidationProvider', scope: ProviderScope.GLOBAL })
export class EnvValidationProvider {
  constructor() {
    const required = ['REDIS_HOST', 'NODE_ENV'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.warn('WARNING: NODE_ENV is not set to "production"');
    }
  }
}
```

## What This Demonstrates

- Configuring Redis for session storage so all instances share state
- Using key prefixes to namespace Redis keys and avoid collisions
- Setting session TTL to prevent unbounded storage growth
- Configuring Redis-backed job store for multi-instance job processing
- Validating required environment variables at startup (fail fast)

## Related

- See `production-node-server` for the full storage and scaling checklist
