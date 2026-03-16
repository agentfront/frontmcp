# manager

Central orchestrator that combines rate limiting, concurrency control, IP filtering, and timeout configuration into a single interface.

## GuardManager

`GuardManager` is constructed with a `NamespacedStorage` instance and a `GuardConfig`. It internally creates a `SlidingWindowRateLimiter`, a `DistributedSemaphore`, and optionally an `IpFilter`. All storage keys are scoped by the namespace prefix.

### Two-level configuration

- **Global** (`config.global`, `config.globalConcurrency`) -- applied to every request, regardless of entity.
- **Default** (`config.defaultRateLimit`, `config.defaultConcurrency`, `config.defaultTimeout`) -- applied to entities that do not supply their own configuration.

When calling `checkRateLimit` or `acquireSemaphore`, you pass the entity-level config (or `undefined`). If `undefined`, the manager falls back to the corresponding default from `GuardConfig`. If no default is configured either, the check is skipped (returns allowed/null).

### Methods

| Method                                                | Description                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `checkIpFilter(clientIp)`                             | Check IP against allow/deny lists. Returns `undefined` if no IP filter configured. |
| `isIpAllowListed(clientIp)`                           | Quick check for allow-list membership.                                             |
| `checkRateLimit(entityName, entityConfig, context)`   | Per-entity rate limit check. Falls back to `defaultRateLimit`.                     |
| `checkGlobalRateLimit(context)`                       | Global rate limit check.                                                           |
| `acquireSemaphore(entityName, entityConfig, context)` | Acquire a per-entity concurrency slot. Falls back to `defaultConcurrency`.         |
| `acquireGlobalSemaphore(context)`                     | Acquire a global concurrency slot.                                                 |
| `destroy()`                                           | Disconnect the underlying storage.                                                 |

## createGuardManager Factory

The `createGuardManager` function handles storage initialization:

1. If `config.storage` is provided, it calls `createStorage(config.storage)` to set up the backend (Redis, Vercel KV, etc.).
2. Otherwise, it creates an in-memory storage and logs a warning.
3. Connects the storage and creates a namespace using `config.keyPrefix` (default: `'mcp:guard:'`).
4. Returns an initialized `GuardManager`.

## Exports

- `GuardManager` -- the orchestrator class
- `createGuardManager` -- async factory function
- `GuardConfig` -- full configuration type
- `GuardLogger` -- minimal logger interface (`info`, `warn`)
- `CreateGuardManagerArgs` -- factory arguments type

## Usage

```typescript
import { createGuardManager } from '@frontmcp/guard';

const guard = await createGuardManager({
  config: {
    enabled: true,
    storage: { provider: 'redis', host: 'localhost', port: 6379 },
    defaultRateLimit: { maxRequests: 100, windowMs: 60_000, partitionBy: 'session' },
    defaultConcurrency: { maxConcurrent: 10, queueTimeoutMs: 5_000 },
    defaultTimeout: { executeMs: 30_000 },
  },
  logger: console,
});

const rl = await guard.checkRateLimit('my-tool', undefined, { sessionId: 's1' });
const ticket = await guard.acquireSemaphore('my-tool', undefined, { sessionId: 's1' });

try {
  // ... execute tool ...
} finally {
  await ticket?.release();
}

await guard.destroy();
```
