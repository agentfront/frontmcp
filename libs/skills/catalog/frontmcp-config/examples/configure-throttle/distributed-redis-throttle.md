---
name: distributed-redis-throttle
reference: configure-throttle
level: advanced
description: 'Configure Redis-backed rate limiting for multi-instance deployments behind a load balancer.'
tags: [config, redis, session, throttle, distributed]
features:
  - "Configuring `storage: { type: 'redis' }` so rate limit counters are shared across instances"
  - 'Using `keyPrefix` to namespace guard keys in a shared Redis instance'
  - "Combining `partitionBy: 'ip'` for global limits with `partitionBy: 'session'` per tool"
  - 'In-memory counters are per-process and would allow N times the intended rate with N instances'
---

# Distributed Rate Limiting with Redis

Configure Redis-backed rate limiting for multi-instance deployments behind a load balancer.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'process_payment',
  description: 'Process a payment transaction',
  inputSchema: {
    amount: z.number(),
    currency: z.string(),
  },
  outputSchema: { transactionId: z.string(), status: z.string() },
  rateLimit: {
    maxRequests: 5,
    windowMs: 60000,
    partitionBy: 'session',
  },
  concurrency: {
    maxConcurrent: 1,
    partitionBy: 'session',
  },
})
class ProcessPaymentTool extends ToolContext {
  async execute(input: { amount: number; currency: string }) {
    return { transactionId: 'txn-abc123', status: 'completed' };
  }
}

@App({
  name: 'payments',
  tools: [ProcessPaymentTool],
})
class PaymentsApp {}

@FrontMcp({
  info: { name: 'payment-server', version: '1.0.0' },
  apps: [PaymentsApp],
  throttle: {
    enabled: true,
    storage: {
      type: 'redis',
      redis: {
        config: {
          host: process.env['REDIS_HOST'] ?? 'redis.internal',
          port: Number(process.env['REDIS_PORT'] ?? 6379),
        },
      },
    },
    keyPrefix: 'payments:guard:',
    global: {
      maxRequests: 500,
      windowMs: 60000,
      partitionBy: 'ip',
    },
    globalConcurrency: {
      maxConcurrent: 20,
      partitionBy: 'global',
    },
  },
})
class Server {}
```

## What This Demonstrates

- Configuring `storage: { type: 'redis' }` so rate limit counters are shared across instances
- Using `keyPrefix` to namespace guard keys in a shared Redis instance
- Combining `partitionBy: 'ip'` for global limits with `partitionBy: 'session'` per tool
- In-memory counters are per-process and would allow N times the intended rate with N instances

## Related

- See `configure-throttle` for the full throttle configuration reference
- See `setup-redis` for Redis provisioning details
