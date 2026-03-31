---
name: docker-redis-local-dev
reference: setup-redis
level: basic
description: 'Provision Redis with Docker Compose and connect a FrontMCP server for local session storage.'
tags: [setup, docker-compose, redis, docker, session, local]
features:
  - 'Docker Compose with Redis 7 Alpine, AOF persistence, and health checks'
  - "`redis` config in `@FrontMcp` with `provider: 'redis'` and environment variable fallbacks"
  - '`--appendonly yes` preserves data across container restarts'
  - "`keyPrefix: 'mcp:'` namespaces all session keys"
---

# Docker Redis for Local Development

Provision Redis with Docker Compose and connect a FrontMCP server for local session storage.

## Code

```yaml
# docker-compose.yml
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

```typescript
// src/main.ts
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    keyPrefix: 'mcp:',
  },
})
export default class Server {}
```

```env
# .env
REDIS_HOST=localhost
REDIS_PORT=6379
```

```bash
# Start Redis and verify
docker compose up -d redis
docker compose exec redis redis-cli ping
# Expected: PONG

# Start the FrontMCP server
frontmcp dev

# Verify session keys after an MCP request
redis-cli -h localhost -p 6379 keys "mcp:*"
```

## What This Demonstrates

- Docker Compose with Redis 7 Alpine, AOF persistence, and health checks
- `redis` config in `@FrontMcp` with `provider: 'redis'` and environment variable fallbacks
- `--appendonly yes` preserves data across container restarts
- `keyPrefix: 'mcp:'` namespaces all session keys

## Related

- See `setup-redis` for Vercel KV, TLS connections, and pub/sub configuration
