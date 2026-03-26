---
name: configure-session
description: Configure session storage with Redis, Vercel KV, or in-memory backends. Use when setting up sessions, choosing a storage provider, or configuring TTL and key prefixes.
tags:
  - session
  - storage
  - redis
  - memory
bundle:
  - recommended
  - full
visibility: both
priority: 5
parameters:
  - name: provider
    description: Session storage provider
    type: string
    required: false
    default: memory
  - name: ttl
    description: Default session TTL in milliseconds
    type: number
    required: false
    default: 3600000
  - name: key-prefix
    description: Redis/KV key prefix for session keys
    type: string
    required: false
    default: 'mcp:session:'
examples:
  - scenario: Configure Redis session store for production
    parameters:
      provider: redis
    expected-outcome: Sessions are persisted in Redis with automatic TTL expiration and key prefixing
  - scenario: Configure Vercel KV for serverless deployment
    parameters:
      provider: vercel-kv
    expected-outcome: Sessions use Vercel KV with environment-based credentials
  - scenario: Use memory store for local development
    parameters:
      provider: memory
    expected-outcome: Sessions are stored in-process memory, suitable for development only
license: Apache-2.0
compatibility: Requires Node.js 18+. Redis provider requires ioredis. Vercel KV provider requires @vercel/kv.
metadata:
  category: auth
  difficulty: beginner
  docs: https://docs.agentfront.dev/frontmcp/deployment/redis-setup
---

# Configure Session Management

This skill covers setting up session storage in FrontMCP. Sessions track authenticated user state, token storage, and request context across MCP interactions.

## Storage Providers

| Provider    | Use Case            | Persistence | Package Required |
| ----------- | ------------------- | ----------- | ---------------- |
| `memory`    | Development/testing | None        | None (default)   |
| `redis`     | Node.js production  | Yes         | `ioredis`        |
| `vercel-kv` | Vercel deployments  | Yes         | `@vercel/kv`     |

Never use the memory store in production. Sessions are lost on process restart, which breaks authentication for all connected clients.

## Redis (Production)

Configure Redis session storage via the `@FrontMcp` decorator:

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';

@App()
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: Number(process.env['REDIS_PORT'] ?? 6379),
    password: process.env['REDIS_PASSWORD'],
  },
})
class MyServer {}
```

The SDK internally calls `createSessionStore()` to create a `RedisSessionStore`. The factory lazy-loads `ioredis` so it is not bundled when you use a different provider.

## Vercel KV

For Vercel deployments, use the `vercel-kv` provider. Credentials are read from environment variables set automatically by the Vercel platform:

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: { provider: 'vercel-kv' },
})
class MyServer {}
```

Required environment variables (auto-injected when a KV store is linked to your Vercel project):

| Variable            | Description                    |
| ------------------- | ------------------------------ |
| `KV_REST_API_URL`   | Vercel KV REST endpoint        |
| `KV_REST_API_TOKEN` | Vercel KV authentication token |

## Memory (Development Default)

When no Redis or KV configuration is provided, the SDK falls back to an in-memory store. This is suitable only for development:

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  // No redis config -- defaults to memory
})
class MyServer {}
```

## Key Prefix

All persistent stores support a `keyPrefix` option that namespaces session keys. This is important when multiple FrontMCP servers share the same Redis instance:

```typescript
@FrontMcp({
  info: { name: 'billing-server', version: '1.0.0' },
  apps: [MyApp],
  redis: {
    provider: 'redis',
    host: 'shared-redis.internal',
    port: 6379,
    keyPrefix: 'billing-mcp:session:',
  },
})
class BillingServer {}
```

Use a unique prefix per server to prevent session key collisions.

## TTL Configuration

The `defaultTtlMs` option controls how long sessions live before expiring:

| Scenario                     | Recommended TTL         |
| ---------------------------- | ----------------------- |
| Interactive user sessions    | `3_600_000` (1 hour)    |
| Long-running agent workflows | `86_400_000` (24 hours) |
| Short-lived CI/CD operations | `600_000` (10 minutes)  |

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: {
    provider: 'redis',
    host: 'localhost',
    port: 6379,
    defaultTtlMs: 86_400_000, // 24 hours for agent workflows
  },
})
class MyServer {}
```

## Pub/Sub for Resource Subscriptions

If your server uses resource subscriptions (clients subscribe to resource change notifications), you need a pub/sub channel. Vercel KV does not support pub/sub, so you must use Redis for the pub/sub channel even when using Vercel KV for sessions:

```typescript
import { createSessionStore, createPubsubStore } from '@frontmcp/sdk/auth/session';

// Sessions in Vercel KV
const sessionStore = await createSessionStore({
  provider: 'vercel-kv',
  url: process.env['KV_REST_API_URL'],
  token: process.env['KV_REST_API_TOKEN'],
});

// Pub/sub requires Redis
const pubsubStore = createPubsubStore({
  provider: 'redis',
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: 6379,
});
```

## Common Mistakes

- **Constructing stores directly** -- always use factory functions (`createSessionStore`). Direct construction bypasses lazy-loading and key prefix normalization.
- **Using memory store in production** -- sessions vanish on restart. Clients must re-authenticate and in-flight workflows are lost.
- **Missing `await` for Vercel KV** -- the `createSessionStore` factory is async when the provider is `vercel-kv`. Forgetting to await causes the store to be used before its connection is ready.
- **Sharing key prefixes** -- if two servers share a Redis instance with the same prefix, their sessions collide. Always use a unique prefix per server.

## Reference

- Session docs: [docs.agentfront.dev/frontmcp/deployment/redis-setup](https://docs.agentfront.dev/frontmcp/deployment/redis-setup)
- Session store factory: `createSessionStore()` — import from `@frontmcp/sdk`
- Redis session store: import from `@frontmcp/auth` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/auth/src/session)
- Vercel KV session store: import from `@frontmcp/auth` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/auth/src/session)
