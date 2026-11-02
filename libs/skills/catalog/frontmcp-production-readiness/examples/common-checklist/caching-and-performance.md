---
name: caching-and-performance
reference: common-checklist
level: advanced
description: Shows how to configure caching with the real `CachePlugin.init(...)` API and how to size connection pools so the server does not exhaust downstream resources.
tags:
  - production
  - redis
  - cache
  - session
  - performance
  - checklist
features:
  - 'Using the real `CachePlugin.init({ type, defaultTTL, toolPatterns })` shape (NOT `new CachePlugin({ ttl: { ... } })`)'
  - 'Setting per-tool TTL via `@Tool({ cache: { ttl } })` metadata in seconds'
  - Using Redis-backed cache for multi-instance consistency
  - Configuring connection pool limits and timeouts to prevent resource exhaustion
  - The pool is created in the constructor and drained in `onShutdown()`, which framework shutdown runs
---

# Caching and Performance Configuration

Shows how to configure caching with the real `CachePlugin.init(...)` API and how to size connection pools so the server does not exhaust downstream resources.

> Note: a GLOBAL provider can implement `onBootstrap()`, `onReady()` and `onShutdown()`. On SIGTERM/SIGINT the framework stops accepting requests, lets the ones in flight finish, then runs every provider's `onShutdown()`; you do not need to wire your own signal handlers.

## Code

```typescript
// src/main.ts
import CachePlugin from '@frontmcp/plugin-cache';
import { FrontMcp } from '@frontmcp/sdk';

import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'perf-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [
    // Real CachePlugin shape — see plugins/plugin-cache/src/cache.types.ts
    CachePlugin.init({
      type: 'redis', // 'memory' | 'redis' | 'redis-client' | 'global-store'
      config: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: 6379,
      },
      defaultTTL: 60, // seconds — defaults to 1 day if omitted
      // Tool name patterns to auto-cache (supports wildcards)
      toolPatterns: ['get-weather', 'list-tasks', 'mintlify:*'],
    }),
  ],

  // Redis for multi-instance shared state (sessions, jobs, global-store)
  redis: {
    provider: 'redis',
    host: process.env.REDIS_HOST ?? 'localhost',
    port: 6379,
  },
})
export default class PerfServer {}
```

```typescript
// src/tools/get-weather.tool.ts — per-tool TTL via metadata
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'get-weather',
  description: 'Fetch weather (slow-changing data — cache 5 minutes)',
  inputSchema: { city: z.string() },
  outputSchema: { temp: z.number() },
  cache: { ttl: 300, slideWindow: false }, // seconds — overrides plugin default
})
export class GetWeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    return { temp: 21 };
  }
}
```

```typescript
// src/providers/db-connection.provider.ts
import { Provider, ProviderScope, type OnShutdown } from '@frontmcp/sdk';

// The class is its own DI token: list it in `providers` and resolve it with `this.get(DbConnectionProvider)`
@Provider({ name: 'DbConnectionProvider', scope: ProviderScope.GLOBAL })
export class DbConnectionProvider implements OnShutdown {
  private readonly pool: { query: Function; end: Function };

  constructor() {
    this.pool = this.createPool({
      host: process.env.DB_HOST,
      max: 20, // Maximum connections — prevents resource exhaustion
      idleTimeoutMs: 30_000, // Close idle connections after 30s
      connectionTimeoutMs: 5_000, // Don't hang on connection attempts
    });
  }

  async query(sql: string, params: unknown[]): Promise<unknown> {
    return this.pool.query(sql, params); // Parameterized — no SQL injection
  }

  async onShutdown(): Promise<void> {
    await this.pool.end(); // Each hook gets `lifecycle.shutdownHookTimeoutMs` (default 3000 ms)
  }

  private createPool(config: Record<string, unknown>): { query: Function; end: Function } {
    // Replace with your database driver (e.g., pg, mysql2)
    throw new Error('Implement with your database driver');
  }
}
```

## What This Demonstrates

- Using the real `CachePlugin.init({ type, defaultTTL, toolPatterns })` shape (NOT `new CachePlugin({ ttl: { ... } })`)
- Setting per-tool TTL via `@Tool({ cache: { ttl } })` metadata in seconds
- Using Redis-backed cache for multi-instance consistency
- Configuring connection pool limits and timeouts to prevent resource exhaustion
- The pool is created in the constructor and drained in `onShutdown()`, which framework shutdown runs

## Related

- See `common-checklist` for the full performance and memory management checklist
- Plugin source: `plugins/plugin-cache/src/cache.types.ts`
