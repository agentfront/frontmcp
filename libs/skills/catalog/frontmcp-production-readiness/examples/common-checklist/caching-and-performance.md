---
name: caching-and-performance
reference: common-checklist
level: advanced
description: 'Shows how to configure caching with TTL, optimize responses, and manage memory with proper provider lifecycle cleanup.'
tags: [production, redis, cache, session, performance, checklist]
features:
  - 'Configuring per-tool cache TTL instead of a single global value'
  - 'Using Redis-backed cache for multi-instance consistency'
  - 'Setting session TTL to prevent unbounded storage growth'
  - 'Implementing `onDestroy()` in providers for proper connection cleanup'
  - 'Using connection pool limits and timeouts to prevent resource exhaustion'
---

# Caching and Performance Configuration

Shows how to configure caching with TTL, optimize responses, and manage memory with proper provider lifecycle cleanup.

## Code

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { CachePlugin } from '@frontmcp/plugins';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'perf-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [
    new CachePlugin({
      // Per-tool TTL tuning (not one-size-fits-all)
      ttl: {
        get_weather: 300_000, // 5 minutes — data changes slowly
        list_tasks: 10_000, // 10 seconds — data changes frequently
      },
      defaultTtl: 60_000, // 1 minute default
    }),
  ],

  // Redis for multi-instance cache consistency
  redis: {
    provider: 'redis',
    host: process.env.REDIS_HOST ?? 'localhost',
    port: 6379,
  },

  // Session TTL to prevent unbounded growth
  session: {
    ttl: 3600_000, // 1 hour
  },
})
export default class PerfServer {}
```

```typescript
// src/providers/db-connection.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const DB_POOL = Symbol('DbPool');

@Provider({ token: DB_POOL, scope: ProviderScope.GLOBAL })
export class DbConnectionProvider {
  private pool!: { query: Function; end: Function };

  async onInit(): Promise<void> {
    // Connection pool with limits — prevents resource exhaustion
    this.pool = await this.createPool({
      host: process.env.DB_HOST,
      max: 20, // Maximum connections
      idleTimeoutMs: 30_000, // Close idle connections after 30s
      connectionTimeoutMs: 5_000, // Don't hang on connection attempts
    });
  }

  async query(sql: string, params: unknown[]): Promise<unknown> {
    return this.pool.query(sql, params); // Parameterized — no SQL injection
  }

  async onDestroy(): Promise<void> {
    // Clean up on shutdown — prevents connection leaks
    await this.pool.end();
  }

  private async createPool(config: Record<string, unknown>): Promise<{ query: Function; end: Function }> {
    // Replace with your database driver (e.g., pg, mysql2)
    throw new Error('Implement with your database driver');
  }
}
```

## What This Demonstrates

- Configuring per-tool cache TTL instead of a single global value
- Using Redis-backed cache for multi-instance consistency
- Setting session TTL to prevent unbounded storage growth
- Implementing `onDestroy()` in providers for proper connection cleanup
- Using connection pool limits and timeouts to prevent resource exhaustion

## Related

- See `common-checklist` for the full performance and memory management checklist
