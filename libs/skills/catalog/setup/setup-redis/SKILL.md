---
name: setup-redis
description: Configure Redis for session storage and distributed state management. Use when adding Redis, Docker Redis, Vercel KV, or setting up pub/sub for resource subscriptions.
category: setup
tags: [setup, redis, storage, session]
targets: [node, vercel]
bundle: [recommended, full]
hasResources: false
storageDefault:
  node: redis-docker
  vercel: vercel-kv
allowed-tools: Bash Write Edit Read Grep
parameters:
  - name: provider
    type: string
    description: How to provision Redis
    enum: [docker, existing, vercel-kv]
    default: docker
  - name: target
    type: string
    description: Deployment target that determines the provider strategy
    enum: [node, vercel, lambda, cloudflare]
    default: node
  - name: host
    type: string
    description: Redis host when using an existing instance
    default: localhost
  - name: port
    type: number
    description: Redis port when using an existing instance
    default: 6379
  - name: keyPrefix
    type: string
    description: Key prefix for all FrontMCP keys in Redis
    default: 'mcp:'
examples:
  - scenario: Set up Redis for local development with Docker
    parameters:
      provider: docker
      target: node
  - scenario: Configure Vercel KV for my Vercel-deployed MCP server
    parameters:
      provider: vercel-kv
      target: vercel
  - scenario: Connect to an existing Redis instance at redis.internal:6380
    parameters:
      provider: existing
      target: node
      host: redis.internal
      port: 6380
compatibility: 'Redis 6+. Docker Engine 20+ for local container. Vercel KV requires a Vercel project with KV store enabled.'
install:
  destinations: [project-local]
  mergeStrategy: overwrite
  dependencies: [setup-project]
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/redis-setup
---

# Configure Redis for Session Storage and Distributed State

## When to Use This Skill

### Must Use

- The server uses Streamable HTTP transport and sessions must survive reconnects
- Multiple server instances run behind a load balancer and need shared state (sessions, rate limits)
- Deploying to serverless (Vercel, Lambda, Cloudflare) where no local filesystem or in-process storage exists

### Recommended

- Resource subscriptions with `subscribe: true` are enabled and need pub/sub
- Auth sessions or elicitation state must persist across server restarts
- Distributed rate limiting is configured in the throttle guard

### Skip When

- Running a single-instance stdio-only server for local development -- use `setup-sqlite` or in-memory stores
- Only need to configure session TTL and key prefix on an already-provisioned Redis -- use `configure-session`
- Deploying a read-only MCP server with no sessions, subscriptions, or stateful tools

> **Decision:** Use this skill to provision and connect Redis (Docker, existing instance, or Vercel KV); use `configure-session` to tune session-specific options after Redis is available.

## Step 1 -- Provision Redis

### Option A: Docker (local development)

Create `docker-compose.yml` in the project root:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 3

volumes:
  redis_data:
```

Start the container:

```bash
docker compose up -d redis
```

Verify the connection:

```bash
docker compose exec redis redis-cli ping
# Expected output: PONG
```

### Option B: Vercel KV (Vercel deployments)

Vercel KV is a managed Redis-compatible store. No Docker or external Redis is needed.

1. Enable KV in the Vercel dashboard: Project Settings > Storage > Create KV Database.
2. Vercel automatically injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables.
3. No manual connection string is needed -- the SDK detects Vercel KV environment variables automatically when `provider: 'vercel-kv'` is set.

### Option C: Existing Redis Instance

If you already have a Redis server (managed cloud, self-hosted, or shared dev instance), collect:

- **Host**: the hostname or IP (e.g., `redis.internal`, `10.0.0.5`)
- **Port**: default `6379`
- **Password**: if auth is enabled
- **TLS**: whether the connection requires TLS (most cloud providers require it)
- **DB index**: default `0`

## Step 2 -- Configure the FrontMCP Server

The `redis` field in the `@FrontMcp` decorator accepts a `RedisOptionsInput` union type. There are three valid shapes:

### For Redis (Docker or existing instance)

Update the `@FrontMcp` decorator in `src/main.ts`:

```typescript
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  redis: {
    provider: 'redis', // 'redis' literal (required)
    host: process.env['REDIS_HOST'] ?? 'localhost', // string (required)
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10), // number (default: 6379)
    password: process.env['REDIS_PASSWORD'], // string (optional)
    db: 0, // number (default: 0)
    tls: false, // boolean (default: false)
    keyPrefix: 'mcp:', // string (default: 'mcp:')
    defaultTtlMs: 3600000, // number (default: 3600000 = 1 hour)
  },
})
export default class Server {}
```

For TLS connections (cloud-hosted Redis):

```typescript
redis: {
  provider: 'redis',
  host: process.env['REDIS_HOST'] ?? 'redis.example.com',
  port: parseInt(process.env['REDIS_PORT'] ?? '6380', 10),
  password: process.env['REDIS_PASSWORD'],
  tls: true,
  keyPrefix: 'mcp:',
},
```

Legacy format (without `provider` field) is also supported and auto-transforms to `provider: 'redis'`:

```typescript
redis: {
  host: 'localhost',
  port: 6379,
},
```

### For Vercel KV

```typescript
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  redis: {
    provider: 'vercel-kv', // 'vercel-kv' literal (required)
    // url and token are auto-detected from KV_REST_API_URL / KV_REST_API_TOKEN env vars
    keyPrefix: 'mcp:', // string (default: 'mcp:')
    defaultTtlMs: 3600000, // number (default: 3600000)
  },
})
export default class Server {}
```

If you need to pass explicit credentials (e.g., in testing or non-Vercel environments):

```typescript
redis: {
  provider: 'vercel-kv',
  url: process.env['KV_REST_API_URL'],               // string (optional, default from env)
  token: process.env['KV_REST_API_TOKEN'],           // string (optional, default from env)
  keyPrefix: 'mcp:',
},
```

## Step 3 -- Session Store Factory (Advanced)

The SDK creates the session store automatically from the `redis` config. For advanced scenarios where you need direct access to the session store factory:

```typescript
import { createSessionStore } from '@frontmcp/sdk';

// Redis provider
const sessionStore = await createSessionStore({
  provider: 'redis',
  host: 'localhost',
  port: 6379,
  keyPrefix: 'mcp:',
});

// Vercel KV provider (requires await for pre-connection)
const sessionStore = await createSessionStore({
  provider: 'vercel-kv',
  keyPrefix: 'mcp:',
});
```

The `createSessionStore()` function signature:

```typescript
async function createSessionStore(
  options: RedisOptions, // RedisProviderOptions | VercelKvProviderOptions | legacy format
  logger?: FrontMcpLogger,
): Promise<SessionStore>;
```

The factory function handles:

- Lazy-loading `ioredis` or `@vercel/kv` to avoid bundling unused dependencies
- Automatic key prefix namespacing (appends `session:` to the base prefix)
- Pre-connection for Vercel KV (the `await` is required)

There is also a synchronous variant for Redis-only (does not support Vercel KV):

```typescript
import { createSessionStoreSync } from '@frontmcp/sdk';

const sessionStore = createSessionStoreSync({
  provider: 'redis',
  host: 'localhost',
  port: 6379,
});
```

## Step 4 -- Pub/Sub for Resource Subscriptions

If your server exposes resources with `subscribe: true`, you need pub/sub. Pub/sub requires a real Redis instance -- Vercel KV does not support pub/sub operations.

For a hybrid setup (Vercel KV for sessions, Redis for pub/sub):

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
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

The `pubsub` field accepts the same shape as `redis` but only supports `provider: 'redis'` or the legacy format (no Vercel KV support for pub/sub).

If only a Redis provider is configured (no Vercel KV), the SDK falls back to using the `redis` config for both sessions and pub/sub automatically. A separate `pubsub` config is only needed when using Vercel KV for sessions.

## Step 5 -- Transport Persistence Auto-Configuration

When `redis` is configured, the SDK automatically enables transport session persistence. The auto-configuration logic works as follows:

1. If `redis` is set and `transport.persistence` is not configured, persistence is auto-enabled with the global redis config.
2. If `transport.persistence` is explicitly `false`, persistence is disabled.
3. If `transport.persistence.redis` is explicitly set, that config is used instead.
4. If `transport.persistence` is an object without `redis`, the global redis config is injected.

This means you do not need to configure `transport.persistence` separately when using the top-level `redis` field.

## Step 6 -- Environment Variables

Add to your `.env` file:

```env
# Redis connection
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Vercel KV (auto-injected on Vercel, manual for local testing)
# KV_REST_API_URL=https://your-kv.kv.vercel-storage.com
# KV_REST_API_TOKEN=your-token

# Pub/Sub (only if different from main Redis)
# REDIS_PUBSUB_HOST=localhost
# REDIS_PUBSUB_PORT=6379
```

Confirm `.env` is in `.gitignore`. Never commit credentials.

## Step 7 -- Test the Connection

### Verify from the application

Start the server and check the logs for successful Redis connection:

```bash
frontmcp dev
```

Look for log lines like:

```
[SessionStoreFactory] Creating Redis session store
[RedisStorageAdapter] Connected to Redis at localhost:6379
```

### Verify from the command line

```bash
# Docker
docker compose exec redis redis-cli -h localhost -p 6379 ping

# Existing instance
redis-cli -h <host> -p <port> -a <password> ping
```

### Verify keys are being written

After making at least one MCP request through HTTP transport:

```bash
redis-cli -h localhost -p 6379 keys "mcp:*"
```

You should see session keys like `mcp:session:<session-id>`.

## Common Patterns

| Pattern                | Correct                                                                                    | Incorrect                                               | Why                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis provider field   | `redis: { provider: 'redis', host: '...', port: 6379 }`                                    | `redis: { host: '...', port: 6379 }` without `provider` | The legacy format without `provider` still works via auto-transform, but explicit `provider: 'redis'` is clearer and required for type checking |
| Environment variables  | `host: process.env['REDIS_HOST'] ?? 'localhost'`                                           | Hardcoding `host: 'redis.internal'` in source           | Hardcoded values break across environments (dev, staging, prod); always read from env with a sensible fallback                                  |
| Vercel KV credentials  | Let Vercel auto-inject `KV_REST_API_URL` and `KV_REST_API_TOKEN`                           | Manually setting KV tokens in the `redis` config object | Auto-injection is safer and ensures tokens rotate correctly; manual values risk stale or committed secrets                                      |
| Docker persistence     | `command: redis-server --appendonly yes` in docker-compose                                 | Running Redis without `--appendonly` in development     | Without AOF persistence, data is lost on container restart; `--appendonly yes` preserves data across restarts                                   |
| Pub/sub with Vercel KV | Separate `pubsub: { provider: 'redis', ... }` alongside `redis: { provider: 'vercel-kv' }` | Expecting Vercel KV to handle pub/sub                   | Vercel KV does not support pub/sub; a real Redis instance is required for resource subscriptions                                                |

## Verification Checklist

### Provisioning

- [ ] Redis is reachable (`redis-cli ping` returns `PONG`, or Vercel KV dashboard shows the store is active)
- [ ] Docker container is running and healthy (`docker compose ps` shows `healthy` status)
- [ ] For existing instances: host, port, password, and TLS settings are correct

### Configuration

- [ ] The `redis` block is present in the `@FrontMcp` decorator with a valid `provider` field (`'redis'` or `'vercel-kv'`)
- [ ] Environment variables (`REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`) are set in `.env`
- [ ] `.env` file is listed in `.gitignore` -- credentials are never committed
- [ ] For Vercel KV: `provider: 'vercel-kv'` is set and KV environment variables are present

### Runtime

- [ ] The server starts without Redis connection errors in the logs
- [ ] `redis-cli keys "mcp:*"` shows keys after at least one MCP request through HTTP transport
- [ ] For pub/sub: a separate `pubsub` config pointing to real Redis is provided when using Vercel KV for sessions

## Troubleshooting

| Problem                               | Cause                                               | Solution                                                                                                      |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:6379`         | Redis is not running or Docker container is stopped | Start the container with `docker compose up -d redis` or check the Redis service status                       |
| `NOAUTH Authentication required`      | Password is set on Redis but not provided in config | Add `password` to the `redis` config or set `REDIS_PASSWORD` environment variable                             |
| `ERR max number of clients reached`   | Too many open connections from the application      | Set `maxRetriesPerRequest` or use connection pooling; check for connection leaks                              |
| Vercel KV `401 Unauthorized`          | Missing or invalid KV tokens in the environment     | Verify `KV_REST_API_URL` and `KV_REST_API_TOKEN` in the Vercel dashboard and redeploy                         |
| Sessions lost after container restart | Redis running without append-only persistence       | Add `--appendonly yes` to the Redis command in docker-compose or use a managed Redis with persistence enabled |

## Reference

- [Redis Setup Docs](https://docs.agentfront.dev/frontmcp/deployment/redis-setup)
- Related skills: `configure-session`, `setup-project`, `setup-sqlite`, `configure-transport`
