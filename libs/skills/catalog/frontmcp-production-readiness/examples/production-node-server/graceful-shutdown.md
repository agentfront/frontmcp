---
name: graceful-shutdown
reference: production-node-server
level: intermediate
description: 'Shows how the framework handles SIGTERM by default and how to add a load-balancer drain signal on top of it without conflicting with the framework lifecycle.'
tags: [production, redis, database, node, graceful, shutdown]
features:
  - 'Framework already wires SIGTERM/SIGINT → `scope.shutdown()` + `mcpServer.close()`'
  - 'Track shutdown state via a `beforeExit` listener so `/healthz` flips unhealthy first'
  - 'Use `server.dispose()` (real method) — `server.close()` does not exist on FrontMcpServerInstance'
  - 'Do NOT install duplicate SIGTERM handlers that call `process.exit(0)` — they race the framework'
---

# Graceful Shutdown with SIGTERM Handling

Shows how to expose load-balancer drain state without overriding the FrontMCP framework's built-in SIGTERM / SIGINT graceful shutdown.

> The framework already installs SIGTERM/SIGINT handlers that:
>
> 1. Unregister the server from the notification bus
> 2. Call `scope.shutdown()` to dispose all providers
> 3. Call `mcpServer.close()` on the underlying transport
> 4. Exit with code 0 (or 1 after a 5s deadline)
>
> See `libs/sdk/src/front-mcp/front-mcp.ts`. **Do not register a second handler that also calls `process.exit()`** — both will fire and race.

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
  // /healthz is auto-registered on Node — see frontmcp-production-readiness
  // health-readiness-endpoints reference.
})
export default class ResilientServer {}
```

```typescript
// src/lifecycle/drain-signal.ts
// Track shutdown state ONLY — the framework owns the actual shutdown sequence.
// Use this for /healthz custom probes so load balancers stop sending traffic
// during the framework's drain window.

let isShuttingDown = false;

export function isDraining(): boolean {
  return isShuttingDown;
}

export function setupDrainSignal(): void {
  // Mark as draining as soon as a signal arrives. The framework's handler
  // also fires (Node calls every listener) and runs the actual shutdown.
  // We do NOT call process.exit() — the framework owns the exit.
  const markDraining = () => {
    isShuttingDown = true;
    console.log('[drain] Marking server as draining for /healthz.');
  };
  process.on('SIGTERM', markDraining);
  process.on('SIGINT', markDraining);
}
```

```typescript
// src/probes/drain-probe.ts — wire into health.probes
import { isDraining } from '../lifecycle/drain-signal';

export const drainProbe = {
  name: 'drain',
  async check() {
    return isDraining() ? { status: 'unhealthy' as const, message: 'shutting down' } : { status: 'healthy' as const };
  },
};
```

## What This Demonstrates

- The framework already handles SIGTERM/SIGINT — never call `server.close()` (no such method) or `process.exit()` on top of it
- Use `server.dispose()` if you need explicit cleanup in non-server (SDK) contexts
- Add a _drain probe_ on `/healthz` so load balancers stop sending traffic during the framework's drain window
- Avoid handler conflicts: registering a second SIGTERM that calls `process.exit(0)` races the framework's own exit path

## Related

- See `production-node-server` for the full process management and scaling checklist
- Framework SIGTERM/SIGINT wiring: `libs/sdk/src/front-mcp/front-mcp.ts`
- Health probes: `references/health-readiness-endpoints.md`
