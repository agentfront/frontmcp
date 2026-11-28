---
name: bring-your-own-redis-client
reference: setup-redis
level: advanced
description: 'Hand FrontMCP an ioredis or node-redis client you built, and keep its lifecycle.'
tags: [setup, redis, cluster, ioredis, node-redis, client, lifecycle]
features:
  - '`redis: { client }` takes an ioredis `Redis`/`Cluster`, a node-redis client/cluster, or a `FrontMcpRedisClient`'
  - 'FrontMCP never closes a client you passed; it closes only the copies it opens with `duplicate()` for pub/sub'
  - 'Nothing about the connection goes beside `client`'
  - 'You close the client after the server stops'
---

# Bring Your Own Redis Client

Hand FrontMCP an ioredis or node-redis client you built, and keep its lifecycle.

## Code

```typescript
// src/redis.ts
import { createCluster } from 'redis';

// node-redis; an ioredis `new Cluster([...])` or `new Redis(...)` works the same way
export const redisClient = createCluster({
  rootNodes: [{ url: process.env['REDIS_URL'] ?? 'redis://localhost:7000' }],
  defaults: { password: process.env['REDIS_AUTH_TOKEN'] },
});
```

```typescript
// src/main.ts
import 'reflect-metadata';

import { FrontMcp } from '@frontmcp/sdk';

import { MyApp } from './my.app';
import { redisClient } from './redis';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: { client: redisClient, keyPrefix: 'mcp:' },
  transport: { persistence: { redis: { client: redisClient } } },
})
export default class Server {}
```

```typescript
// On shutdown, after the server has stopped: the client is yours to close
await redisClient.close();
```

## What This Demonstrates

- `redis: { client }` takes an ioredis `Redis`/`Cluster`, a node-redis client/cluster, or a `FrontMcpRedisClient`
- FrontMCP never closes a client you passed; it closes only the copies it opens with `duplicate()` for pub/sub
- Nothing about the connection goes beside `client`
- You close the client after the server stops

## Related

- See `setup-redis` for `cluster: true` when you'd rather let FrontMCP open the cluster client
