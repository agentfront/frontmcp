---
name: hybrid-vercel-kv-with-pubsub
reference: setup-redis
level: advanced
description: 'Use Vercel KV for session storage and a separate Redis instance for pub/sub resource subscriptions.'
tags: [setup, vercel-kv, redis, vercel, session, hybrid]
features:
  - 'Vercel KV handles sessions (`redis` config) while a real Redis handles pub/sub (`pubsub` config)'
  - 'Vercel KV does not support pub/sub operations, so a separate Redis instance is required'
  - 'Resources with `subscribe: true` rely on the `pubsub` config for real-time notifications'
  - "The `pubsub` field accepts `provider: 'redis'` only (no Vercel KV support)"
---

# Hybrid Vercel KV with Redis Pub/Sub

Use Vercel KV for session storage and a separate Redis instance for pub/sub resource subscriptions.

## Code

```typescript
// src/main.ts
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-hybrid-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  transport: { protocol: 'modern' },
  redis: {
    provider: 'vercel-kv',
    keyPrefix: 'mcp:',
  },
  pubsub: {
    provider: 'redis',
    host: process.env['REDIS_PUBSUB_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PUBSUB_PORT'] ?? '6379', 10),
    password: process.env['REDIS_PUBSUB_PASSWORD'],
  },
})
export default class Server {}
```

```typescript
// src/resources/live-metrics.resource.ts
import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({
  uri: 'metrics://live',
  name: 'Live Metrics',
  mimeType: 'application/json',
  subscribe: true,
})
export default class LiveMetricsResource extends ResourceContext {
  async read() {
    return { contents: [{ uri: 'metrics://live', text: '{"cpu":45,"memory":72}' }] };
  }
}
```

```env
# .env
REDIS_PUBSUB_HOST=redis.internal
REDIS_PUBSUB_PORT=6379
REDIS_PUBSUB_PASSWORD=secret
```

## What This Demonstrates

- Vercel KV handles sessions (`redis` config) while a real Redis handles pub/sub (`pubsub` config)
- Vercel KV does not support pub/sub operations, so a separate Redis instance is required
- Resources with `subscribe: true` rely on the `pubsub` config for real-time notifications
- The `pubsub` field accepts `provider: 'redis'` only (no Vercel KV support)

## Related

- See `setup-redis` for single-provider Redis setups and session store factory usage
