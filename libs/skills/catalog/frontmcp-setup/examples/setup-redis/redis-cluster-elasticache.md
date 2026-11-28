---
name: redis-cluster-elasticache
reference: setup-redis
level: intermediate
description: 'Run several FrontMCP instances on an AWS ElastiCache cluster (cluster mode on, TLS) with `cluster: true`.'
tags: [setup, redis, cluster, elasticache, aws, session, tls]
features:
  - '`cluster: true` beside `host`/`port` (or `url`) opens a Redis Cluster client from the configuration endpoint'
  - 'The AUTH token and TLS apply to every node, and hostnames are kept for the TLS certificate'
  - 'One `redis` value shared by `redis` and `transport.persistence.redis`, so a session opened on one instance is served by the others'
  - 'Every instance shares `MCP_SESSION_SECRET`, or a session id minted by one is a 404 on the others'
---

# Redis Cluster on AWS ElastiCache

Run several FrontMCP instances on an AWS ElastiCache cluster (cluster mode on, TLS) with `cluster: true`.

## Code

```typescript
// src/main.ts
import 'reflect-metadata';

import { FrontMcp, type RedisOptionsInput } from '@frontmcp/sdk';

import { MyApp } from './my.app';

const redis: RedisOptionsInput = {
  provider: 'redis',
  // The configuration endpoint, not a node endpoint
  host: process.env['REDIS_HOST'] ?? 'my-cluster.xxxxxx.clustercfg.use2.cache.amazonaws.com',
  port: 6379,
  password: process.env['REDIS_AUTH_TOKEN'],
  tls: true,
  cluster: true,
};

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis,
  transport: {
    protocol: 'modern',
    persistence: { redis, defaultTtlMs: 3_600_000 },
  },
})
export default class Server {}
```

```bash
# The same on every instance
export MCP_SESSION_SECRET="$(openssl rand -hex 32)"
export VAULT_SECRET="$(openssl rand -hex 32)"
```

## What This Demonstrates

- `cluster: true` beside `host`/`port` (or `url`) opens a Redis Cluster client from the configuration endpoint
- The AUTH token and TLS apply to every node, and hostnames are kept for the TLS certificate
- One `redis` value shared by `redis` and `transport.persistence.redis`, so a session opened on one instance is served by the others
- Every instance shares `MCP_SESSION_SECRET`, or a session id minted by one is a 404 on the others

## Related

- See `setup-redis` for the `cluster: { nodes, options }` form and for passing a client you built
