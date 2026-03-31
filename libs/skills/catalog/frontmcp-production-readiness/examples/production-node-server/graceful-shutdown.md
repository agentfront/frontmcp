---
name: graceful-shutdown
reference: production-node-server
level: intermediate
description: 'Shows how to implement graceful shutdown with SIGTERM handling, in-flight request draining, and health check status transitions.'
tags: [production, redis, database, node, graceful, shutdown]
features:
  - 'Handling SIGTERM for graceful shutdown in containerized environments'
  - 'Draining in-flight requests before exiting with a timeout safety net'
  - 'Disposing all resources (Redis, database) via `server.dispose()`'
  - 'Returning unhealthy during shutdown so load balancers redirect traffic'
---

# Graceful Shutdown with SIGTERM Handling

Shows how to implement graceful shutdown with SIGTERM handling, in-flight request draining, and health check status transitions.

## Code

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'resilient-server', version: '1.0.0' },
  apps: [MyApp],
  redis: {
    provider: 'redis',
    host: process.env.REDIS_HOST ?? 'localhost',
    port: 6379,
  },
})
export default class ResilientServer {}
```

```typescript
// src/lifecycle/shutdown.ts
// Graceful shutdown handler — wire this in your entry point

let isShuttingDown = false;

export function setupGracefulShutdown(server: { close: () => Promise<void>; dispose: () => Promise<void> }): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`Received ${signal}. Starting graceful shutdown...`);

    // 1. Stop accepting new connections
    await server.close();
    console.log('Server closed — no new connections accepted.');

    // 2. Wait for in-flight requests to complete (with timeout)
    const drainTimeout = setTimeout(() => {
      console.error('Drain timeout reached. Forcing exit.');
      process.exit(1);
    }, 30_000); // 30 second drain period

    // 3. Dispose all resources (Redis, DB connections, providers)
    await server.dispose();
    clearTimeout(drainTimeout);
    console.log('All resources disposed. Exiting.');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export function isHealthy(): boolean {
  // Return unhealthy during shutdown drain so load balancers stop sending traffic
  return !isShuttingDown;
}
```

## What This Demonstrates

- Handling SIGTERM for graceful shutdown in containerized environments
- Draining in-flight requests before exiting with a timeout safety net
- Disposing all resources (Redis, database) via `server.dispose()`
- Returning unhealthy during shutdown so load balancers redirect traffic

## Related

- See `production-node-server` for the full process management and scaling checklist
