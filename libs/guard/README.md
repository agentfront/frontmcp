# @frontmcp/guard

![npm version](https://img.shields.io/npm/v/@frontmcp/guard)
![license](https://img.shields.io/npm/l/@frontmcp/guard)

Rate limiting, concurrency control, timeout enforcement, and IP filtering for FrontMCP applications. Built on the `StorageAdapter` interface from `@frontmcp/utils`, so it works with Memory, Redis, Vercel KV, and Upstash backends out of the box.

## Installation

```bash
npm install @frontmcp/guard
# or
yarn add @frontmcp/guard
```

Peer dependency:

```bash
npm install zod@^4
```

## Quick Start

```typescript
import { createGuardManager } from '@frontmcp/guard';

const guard = await createGuardManager({
  config: {
    enabled: true,
    global: { maxRequests: 100, windowMs: 60_000 },
    defaultTimeout: { executeMs: 30_000 },
    ipFilter: {
      denyList: ['10.0.0.0/8'],
      defaultAction: 'allow',
    },
  },
});

// Check IP filter
const ipResult = guard.checkIpFilter('203.0.113.5');

// Check rate limit
const rlResult = await guard.checkRateLimit('my-tool', undefined, {
  sessionId: 'sess-123',
});

// Acquire concurrency slot
const ticket = await guard.acquireSemaphore(
  'my-tool',
  { maxConcurrent: 5 },
  {
    sessionId: 'sess-123',
  },
);
try {
  // ... do work ...
} finally {
  await ticket?.release();
}
```

## Modules

| Module           | Main Export                           | Purpose                                                               |
| ---------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `errors/`        | `GuardError` + subclasses             | Error hierarchy with machine-readable codes and HTTP status codes     |
| `schemas/`       | `guardConfigSchema`                   | Zod validation schemas for all configuration objects                  |
| `partition-key/` | `resolvePartitionKey`                 | Resolves request partition keys (ip, session, userId, global, custom) |
| `rate-limit/`    | `SlidingWindowRateLimiter`            | Sliding window counter rate limiter                                   |
| `concurrency/`   | `DistributedSemaphore`                | Distributed semaphore for concurrency control                         |
| `timeout/`       | `withTimeout`                         | Async execution timeout wrapper                                       |
| `ip-filter/`     | `IpFilter`                            | IP allow/deny list filtering with CIDR support                        |
| `manager/`       | `GuardManager` + `createGuardManager` | Orchestrator combining all guard modules                              |

## Rate Limiting

Uses the **sliding window counter** algorithm. Two adjacent fixed-window counters are maintained; their counts are combined with a time-weighted interpolation to approximate a true sliding window. This provides O(1) storage per key while avoiding the burst edges of simple fixed-window counters.

```typescript
import { SlidingWindowRateLimiter } from '@frontmcp/guard';

const limiter = new SlidingWindowRateLimiter(storageAdapter);

const result = await limiter.check(
  'user:42', // partition key
  100, // max requests
  60_000, // window in ms
);

if (!result.allowed) {
  console.log(`Rate limited. Retry after ${result.retryAfterMs}ms`);
}
```

The `RateLimitResult` includes:

- `allowed` -- whether the request can proceed
- `remaining` -- approximate remaining requests in this window
- `resetMs` -- milliseconds until the current window resets
- `retryAfterMs` -- (only when blocked) suggested retry delay

## Concurrency Control

The `DistributedSemaphore` limits the number of concurrent executions for a given key. Each execution acquires a "ticket" via atomic `incr` on a counter key. Individual ticket keys are stored with a TTL for crash safety -- if a process dies without releasing, the ticket TTL expires and the counter self-corrects.

When all slots are full, callers can optionally wait in a queue with exponential backoff polling. If the storage backend supports pub/sub, slot releases trigger immediate wakeup of waiting callers.

```typescript
import { DistributedSemaphore } from '@frontmcp/guard';

const semaphore = new DistributedSemaphore(storageAdapter, 300 /* ticket TTL seconds */);

const ticket = await semaphore.acquire(
  'my-tool:global', // key
  5, // max concurrent
  10_000, // queue timeout ms (0 = no wait)
  'my-tool', // entity name (for error messages)
);

if (!ticket) {
  // Rejected (queueTimeoutMs was 0 and all slots full)
  return;
}

try {
  await doWork();
} finally {
  await ticket.release();
}
```

Additional methods:

- `getActiveCount(key)` -- returns the current number of active tickets
- `forceReset(key)` -- resets the counter and removes all ticket keys

## Timeout

The `withTimeout` utility wraps an async function with a deadline using `AbortController` + `Promise.race`. Throws `ExecutionTimeoutError` if the function does not complete within the specified duration.

```typescript
import { withTimeout } from '@frontmcp/guard';

const result = await withTimeout(
  () => fetchData(),
  5_000, // timeout in ms
  'fetch-data', // entity name (for error messages)
);
```

## IP Filtering

The `IpFilter` class checks client IP addresses against allow and deny lists. Supports individual IP addresses and CIDR notation for both IPv4 and IPv6. IPv4-mapped IPv6 addresses (e.g., `::ffff:192.168.1.1`) are also handled.

**Precedence**: the deny list is always checked first. If an IP matches the deny list, it is blocked regardless of the allow list. If an allow list is configured and the IP does not match any allow rule, the `defaultAction` determines the outcome.

All matching is performed using bigint arithmetic for correctness across the full IPv6 address space.

```typescript
import { IpFilter } from '@frontmcp/guard';

const filter = new IpFilter({
  allowList: ['192.168.0.0/16'],
  denyList: ['192.168.1.100'],
  defaultAction: 'deny',
});

const result = filter.check('192.168.2.50');
// { allowed: true, reason: 'allowlisted', matchedRule: '192.168.0.0/16' }

const blocked = filter.check('192.168.1.100');
// { allowed: false, reason: 'denylisted', matchedRule: '192.168.1.100' }
```

The `isAllowListed(ip)` method provides a quick check for whether an IP is on the allow list, which can be used to bypass rate limiting for trusted addresses.

## Partition Keys

Partition keys determine how rate limits and concurrency slots are bucketed. Built-in strategies:

| Strategy    | Behavior                                                        |
| ----------- | --------------------------------------------------------------- |
| `'global'`  | Single shared bucket for all callers (default)                  |
| `'ip'`      | One bucket per client IP address                                |
| `'session'` | One bucket per session ID                                       |
| `'userId'`  | One bucket per authenticated user ID (falls back to session ID) |

You can also pass a custom function:

```typescript
const config: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60_000,
  partitionBy: (ctx) => `org:${ctx.userId?.split(':')[0]}`,
};
```

The `PartitionKeyContext` passed to custom functions contains `sessionId` (always present), plus optional `clientIp` and `userId`.

## Guard Manager

`GuardManager` is the central orchestrator. It combines rate limiting, concurrency control, IP filtering, and timeout configuration into a single interface. The `createGuardManager` factory handles storage initialization.

The manager supports two levels of configuration:

- **Global** -- applied to every request (`global`, `globalConcurrency`)
- **Default** -- applied to entities that do not specify their own config (`defaultRateLimit`, `defaultConcurrency`, `defaultTimeout`)

Per-entity configuration takes precedence over defaults.

```typescript
import { createGuardManager } from '@frontmcp/guard';

const guard = await createGuardManager({
  config: {
    enabled: true,
    storage: { provider: 'redis', host: 'localhost', port: 6379 },
    keyPrefix: 'myapp:guard:',
    global: { maxRequests: 1000, windowMs: 60_000, partitionBy: 'ip' },
    globalConcurrency: { maxConcurrent: 50, partitionBy: 'global' },
    defaultRateLimit: { maxRequests: 100, windowMs: 60_000, partitionBy: 'session' },
    defaultConcurrency: { maxConcurrent: 10, queueTimeoutMs: 5_000 },
    defaultTimeout: { executeMs: 30_000 },
    ipFilter: {
      denyList: ['10.0.0.0/8'],
      allowList: ['10.0.1.0/24'],
      defaultAction: 'allow',
      trustProxy: true,
      trustedProxyDepth: 2,
    },
  },
  logger: console,
});

// Use the manager
const globalRl = await guard.checkGlobalRateLimit({ sessionId: 'sess-1' });
const entityRl = await guard.checkRateLimit('my-tool', undefined, { sessionId: 'sess-1' });
const ticket = await guard.acquireSemaphore('my-tool', undefined, { sessionId: 'sess-1' });

// Cleanup
await guard.destroy();
```

## Configuration Reference

### `GuardConfig`

| Field                | Type                | Default        | Description                                              |
| -------------------- | ------------------- | -------------- | -------------------------------------------------------- |
| `enabled`            | `boolean`           | --             | Whether the guard system is active                       |
| `storage`            | `StorageConfig`     | memory         | Storage backend configuration                            |
| `keyPrefix`          | `string`            | `'mcp:guard:'` | Prefix for all storage keys                              |
| `global`             | `RateLimitConfig`   | --             | Global rate limit for ALL requests                       |
| `globalConcurrency`  | `ConcurrencyConfig` | --             | Global concurrency limit                                 |
| `defaultRateLimit`   | `RateLimitConfig`   | --             | Default rate limit for entities without explicit config  |
| `defaultConcurrency` | `ConcurrencyConfig` | --             | Default concurrency for entities without explicit config |
| `defaultTimeout`     | `TimeoutConfig`     | --             | Default timeout for entity execution                     |
| `ipFilter`           | `IpFilterConfig`    | --             | IP filtering configuration                               |

### `RateLimitConfig`

| Field         | Type           | Default    | Description                         |
| ------------- | -------------- | ---------- | ----------------------------------- |
| `maxRequests` | `number`       | --         | Maximum requests allowed per window |
| `windowMs`    | `number`       | `60000`    | Time window in milliseconds         |
| `partitionBy` | `PartitionKey` | `'global'` | Partition key strategy              |

### `ConcurrencyConfig`

| Field            | Type           | Default    | Description                                     |
| ---------------- | -------------- | ---------- | ----------------------------------------------- |
| `maxConcurrent`  | `number`       | --         | Maximum concurrent executions                   |
| `queueTimeoutMs` | `number`       | `0`        | Max wait time in queue (0 = reject immediately) |
| `partitionBy`    | `PartitionKey` | `'global'` | Partition key strategy                          |

### `TimeoutConfig`

| Field       | Type     | Default | Description                            |
| ----------- | -------- | ------- | -------------------------------------- |
| `executeMs` | `number` | --      | Maximum execution time in milliseconds |

### `IpFilterConfig`

| Field               | Type                | Default   | Description                                 |
| ------------------- | ------------------- | --------- | ------------------------------------------- |
| `allowList`         | `string[]`          | --        | IP addresses or CIDR ranges to always allow |
| `denyList`          | `string[]`          | --        | IP addresses or CIDR ranges to always block |
| `defaultAction`     | `'allow' \| 'deny'` | `'allow'` | Action when IP matches neither list         |
| `trustProxy`        | `boolean`           | `false`   | Trust X-Forwarded-For header                |
| `trustedProxyDepth` | `number`            | `1`       | Max proxies to trust from X-Forwarded-For   |

## Storage Backends

The guard library delegates all persistence to the `StorageAdapter` interface from `@frontmcp/utils`. Choose a backend based on your deployment:

| Backend       | Use Case                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| **Memory**    | Development, testing, single-process deployments. Not suitable for distributed setups.                       |
| **Redis**     | Production multi-instance deployments. Provides atomic operations and optional pub/sub for semaphore wakeup. |
| **Vercel KV** | Vercel-hosted applications. Redis-compatible API.                                                            |
| **Upstash**   | Serverless environments. HTTP-based Redis compatible.                                                        |

If no `storage` config is provided, the factory falls back to in-memory storage and logs a warning.

## Error Handling

All errors extend `GuardError`, which carries a machine-readable `code` and an HTTP `statusCode`.

| Error Class             | Code                | Status | When                                                   |
| ----------------------- | ------------------- | ------ | ------------------------------------------------------ |
| `GuardError`            | (base)              | --     | Base class for all guard errors                        |
| `ExecutionTimeoutError` | `EXECUTION_TIMEOUT` | `408`  | Execution exceeds configured timeout                   |
| `ConcurrencyLimitError` | `CONCURRENCY_LIMIT` | `429`  | Concurrency limit reached (no queue or queue disabled) |
| `QueueTimeoutError`     | `QUEUE_TIMEOUT`     | `429`  | Waited in concurrency queue but timed out              |
| `IpBlockedError`        | `IP_BLOCKED`        | `403`  | Client IP is on the deny list                          |
| `IpNotAllowedError`     | `IP_NOT_ALLOWED`    | `403`  | Client IP is not on the allow list                     |

```typescript
import { GuardError, ExecutionTimeoutError } from '@frontmcp/guard';

try {
  await withTimeout(() => slowOp(), 5_000, 'slow-op');
} catch (err) {
  if (err instanceof ExecutionTimeoutError) {
    console.log(err.code); // 'EXECUTION_TIMEOUT'
    console.log(err.statusCode); // 408
    console.log(err.timeoutMs); // 5000
  }
}
```

## API Reference

### Classes

| Export                     | Module        | Description                                      |
| -------------------------- | ------------- | ------------------------------------------------ |
| `SlidingWindowRateLimiter` | `rate-limit`  | Sliding window counter rate limiter              |
| `DistributedSemaphore`     | `concurrency` | Distributed semaphore with ticket-based tracking |
| `IpFilter`                 | `ip-filter`   | IP allow/deny list with CIDR support             |
| `GuardManager`             | `manager`     | Central orchestrator for all guard modules       |

### Functions

| Export                | Module          | Description                                              |
| --------------------- | --------------- | -------------------------------------------------------- |
| `withTimeout`         | `timeout`       | Wrap an async function with a deadline                   |
| `resolvePartitionKey` | `partition-key` | Resolve a partition key string from strategy and context |
| `buildStorageKey`     | `partition-key` | Build a namespaced storage key                           |
| `createGuardManager`  | `manager`       | Factory to create and initialize a `GuardManager`        |

### Error Classes

| Export                  | Module   | Description               |
| ----------------------- | -------- | ------------------------- |
| `GuardError`            | `errors` | Base error class          |
| `ExecutionTimeoutError` | `errors` | Timeout exceeded          |
| `ConcurrencyLimitError` | `errors` | Concurrency limit reached |
| `QueueTimeoutError`     | `errors` | Queue wait timed out      |
| `IpBlockedError`        | `errors` | IP on deny list           |
| `IpNotAllowedError`     | `errors` | IP not on allow list      |

### Zod Schemas

| Export                    | Module    | Description                                         |
| ------------------------- | --------- | --------------------------------------------------- |
| `partitionKeySchema`      | `schemas` | Validates partition key strategy or custom function |
| `rateLimitConfigSchema`   | `schemas` | Validates `RateLimitConfig`                         |
| `concurrencyConfigSchema` | `schemas` | Validates `ConcurrencyConfig`                       |
| `timeoutConfigSchema`     | `schemas` | Validates `TimeoutConfig`                           |
| `ipFilterConfigSchema`    | `schemas` | Validates `IpFilterConfig`                          |
| `guardConfigSchema`       | `schemas` | Validates the full `GuardConfig`                    |

### Types

| Export                   | Module          | Description                                 |
| ------------------------ | --------------- | ------------------------------------------- |
| `RateLimitConfig`        | `rate-limit`    | Rate limit configuration                    |
| `RateLimitResult`        | `rate-limit`    | Result from a rate limit check              |
| `ConcurrencyConfig`      | `concurrency`   | Concurrency control configuration           |
| `SemaphoreTicket`        | `concurrency`   | Acquired concurrency slot handle            |
| `TimeoutConfig`          | `timeout`       | Timeout configuration                       |
| `IpFilterConfig`         | `ip-filter`     | IP filter configuration                     |
| `IpFilterResult`         | `ip-filter`     | Result from an IP filter check              |
| `PartitionKeyStrategy`   | `partition-key` | Built-in partition key strategies union     |
| `CustomPartitionKeyFn`   | `partition-key` | Custom partition key resolver function      |
| `PartitionKeyContext`    | `partition-key` | Context passed to partition key resolvers   |
| `PartitionKey`           | `partition-key` | Union of strategy string or custom function |
| `GuardConfig`            | `manager`       | Full guard configuration                    |
| `GuardLogger`            | `manager`       | Minimal logger interface                    |
| `CreateGuardManagerArgs` | `manager`       | Arguments for `createGuardManager`          |

## License

Apache-2.0
