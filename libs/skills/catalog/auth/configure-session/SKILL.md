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

## When to Use This Skill

### Must Use

- Deploying to production where sessions must survive process restarts (Redis or Vercel KV required)
- Running multiple server instances behind a load balancer that need shared session state
- Using Streamable HTTP transport where sessions must persist across reconnects

### Recommended

- Configuring session TTL to match your workload pattern (interactive, agent, CI/CD)
- Namespacing session keys with a unique `keyPrefix` when sharing a Redis instance across multiple servers
- Setting up Vercel KV for serverless deployments on the Vercel platform

### Skip When

- Running a single-instance local development server -- the default in-memory store is sufficient
- Using stdio transport only where session persistence is not needed
- Need to provision Redis itself rather than configure sessions -- use `setup-redis` first, then return here

> **Decision:** Use this skill to choose and configure a session storage provider (memory, Redis, or Vercel KV) and tune TTL and key prefix settings; use `setup-redis` if Redis is not yet provisioned.

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

## Common Patterns

| Pattern                | Correct                                                                                      | Incorrect                                                                     | Why                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Store construction     | Use `createSessionStore()` factory function                                                  | `new RedisSessionStore(client)` direct construction                           | The factory handles lazy-loading, key prefix normalization, and provider detection automatically               |
| Vercel KV creation     | `const store = await createSessionStore({ provider: 'vercel-kv' })`                          | `const store = createSessionStore({ provider: 'vercel-kv' })` without `await` | The factory is async for Vercel KV; forgetting `await` uses the store before its connection is ready           |
| Key prefix per server  | `keyPrefix: 'billing-mcp:session:'` unique per server                                        | Same `keyPrefix` across multiple servers sharing one Redis instance           | Shared prefixes cause session key collisions; one server may read or overwrite another's sessions              |
| Production storage     | `redis: { provider: 'redis', host: '...' }` or `redis: { provider: 'vercel-kv' }`            | Omitting redis config in production (falls back to memory)                    | Memory sessions vanish on restart; all connected clients must re-authenticate and in-flight workflows are lost |
| Pub/sub with Vercel KV | Separate `pubsub` config pointing to real Redis alongside `redis: { provider: 'vercel-kv' }` | Expecting Vercel KV to handle pub/sub                                         | Vercel KV does not support pub/sub operations; a real Redis instance is required for resource subscriptions    |

## Verification Checklist

### Configuration

- [ ] `redis` block is present in the `@FrontMcp` decorator with a valid `provider` field (`'redis'` or `'vercel-kv'`)
- [ ] `keyPrefix` is unique per server when sharing a Redis instance
- [ ] `defaultTtlMs` matches the workload pattern (1 hour for interactive, 24 hours for agents, 10 minutes for CI/CD)

### Vercel KV

- [ ] `provider: 'vercel-kv'` is set in the `redis` config
- [ ] `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables are present (auto-injected on Vercel)
- [ ] A separate `pubsub` config pointing to real Redis is provided if resource subscriptions are used

### Runtime

- [ ] Server starts without Redis connection errors in the logs
- [ ] `redis-cli keys "mcp:session:*"` shows session keys after an MCP request (for Redis provider)
- [ ] Sessions persist across server restarts (for Redis/Vercel KV providers)
- [ ] Sessions expire after the configured TTL

## Troubleshooting

| Problem                                | Cause                                                          | Solution                                                                                       |
| -------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Sessions lost after server restart     | Using the default in-memory store in production                | Configure `redis: { provider: 'redis' }` or `redis: { provider: 'vercel-kv' }` for persistence |
| `ECONNREFUSED` on startup              | Redis is not running or host/port is incorrect                 | Start the Redis container (`docker compose up -d redis`) or verify connection details          |
| Vercel KV `401 Unauthorized`           | Missing or invalid KV tokens                                   | Check `KV_REST_API_URL` and `KV_REST_API_TOKEN` in the Vercel dashboard and redeploy           |
| Session key collisions between servers | Multiple servers share the same Redis instance and `keyPrefix` | Set a unique `keyPrefix` per server (e.g., `billing-mcp:session:`, `api-mcp:session:`)         |
| Pub/sub not working with Vercel KV     | Vercel KV does not support pub/sub operations                  | Add a separate `pubsub` config pointing to a real Redis instance                               |

## Reference

- [Session Storage Docs](https://docs.agentfront.dev/frontmcp/deployment/redis-setup)
- Related skills: `setup-redis`, `configure-auth`, `configure-transport`, `configure-elicitation`
