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

  // Session configuration
  session: {
    ttl: 3600_000, // 1 hour session TTL
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
    retry: {
      maxAttempts: 3,
      maxBackoffMs: 30_000,
    },
  },
})
export default class ScalableServer {}
```

```typescript
// src/providers/env-validation.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const ENV_VALIDATOR = Symbol('EnvValidator');

@Provider({ token: ENV_VALIDATOR, scope: ProviderScope.GLOBAL })
export class EnvValidationProvider {
  async onInit(): Promise<void> {
    // Fail fast on missing config — don't discover in production at runtime
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
