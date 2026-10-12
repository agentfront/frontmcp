# @frontmcp/guard

Rate limiting, concurrency limits, execution timeouts and IP filtering for FrontMCP. `@frontmcp/sdk` uses it for the `throttle` option of `@FrontMcp` and the `rateLimit`, `concurrency` and `timeout` options of tools and agents, so in a FrontMCP server you set those options and don't import this package. Install it directly to use the limiters on their own. They keep their counters behind the `StorageAdapter` interface of `@frontmcp/utils`, so they work with memory, Redis, Vercel KV, Upstash and Cloudflare KV storage.

[![npm](https://img.shields.io/npm/v/@frontmcp/guard.svg)](https://www.npmjs.com/package/@frontmcp/guard) [![License](https://img.shields.io/npm/l/@frontmcp/guard.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/guard @frontmcp/lazy-zod zod
```

`@frontmcp/lazy-zod` is a peer dependency (the configuration schemas use it), and it needs `zod` 4. Node.js 24 or later. A FrontMCP server doesn't need this install: `@frontmcp/sdk` depends on `@frontmcp/guard` and re-exports everything in it.

## Usage

### In a FrontMCP server

Set limits on a tool, and defaults for the whole server. The SDK passes these options to this package:

```typescript
import { App, FrontMcp, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'export_tickets',
  description: 'Export every ticket as CSV. At most 2 exports an hour per caller, one at a time.',
  inputSchema: {},
  rateLimit: { maxRequests: 2, windowMs: 60 * 60_000, partitionBy: 'userId' },
  concurrency: { maxConcurrent: 1, queueTimeoutMs: 5_000 },
  timeout: { executeMs: 30_000 },
})
class ExportTickets extends ToolContext {
  async execute() {
    return { csv: 'id,title' };
  }
}

@App({ id: 'help-desk', name: 'Help Desk', tools: [ExportTickets] })
class HelpDeskApp {}

@FrontMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [HelpDeskApp],
  throttle: {
    enabled: true,
    defaultRateLimit: { maxRequests: 60, windowMs: 60_000, partitionBy: 'userId' },
    global: { maxRequests: 1_000, windowMs: 60_000, partitionBy: 'ip' },
    ipFilter: { denyList: ['192.0.2.0/24'] },
  },
})
export default class Server {}
```

[Guard options](https://frontmcp.dev/reference/sdk/guard) covers what each option does in a server, and the error a caller gets back.

### On its own

`createGuardManager` builds a `GuardManager` from one configuration object:

```typescript
import { createGuardManager } from '@frontmcp/guard';

const guard = await createGuardManager({
  config: {
    enabled: true,
    defaultRateLimit: { maxRequests: 100, windowMs: 60_000, partitionBy: 'session' },
    defaultConcurrency: { maxConcurrent: 5 },
    ipFilter: { denyList: ['10.0.0.0/8'], defaultAction: 'allow' },
  },
});

const ipResult = guard.checkIpFilter('203.0.113.5');
if (ipResult && !ipResult.allowed) throw new Error('IP refused');

const rateLimit = await guard.checkRateLimit('my-tool', undefined, { sessionId: 'sess-123' });
if (!rateLimit.allowed) throw new Error(`Retry after ${rateLimit.retryAfterMs}ms`);

const ticket = await guard.acquireSemaphore('my-tool', undefined, { sessionId: 'sess-123' });
if (!ticket) throw new Error('No free slot');
try {
  // ... do the work ...
} finally {
  await ticket.release();
}

await guard.destroy();
```

Without a `storage` configuration the manager keeps its counters in memory, one set per process, and warns about it through `logger` when you pass one.

## Rate limiting

`SlidingWindowRateLimiter` uses the sliding window counter algorithm. It keeps two adjacent fixed-window counters and weights the previous window's count by how much of that window still falls within `windowMs` of now. That approximates a true sliding window with constant storage per key, without the bursts a single fixed window allows at its edges. Windows are aligned to the clock.

The class takes a storage adapter. `createMemoryStorage` and the other adapters come from `@frontmcp/utils`, which is installed with this package; add it to your own dependencies to import it.

```typescript
import { SlidingWindowRateLimiter } from '@frontmcp/guard';
import { createMemoryStorage } from '@frontmcp/utils';

const storage = createMemoryStorage();
await storage.connect();
const limiter = new SlidingWindowRateLimiter(storage);

const result = await limiter.check(
  'user:42', // key
  100, // max requests
  60_000, // window in ms
);

if (!result.allowed) {
  console.log(`Rate limited. Retry after ${result.retryAfterMs}ms`);
}
```

An allowed check counts the request. `RateLimitResult` has:

- `allowed`: whether the request can proceed
- `remaining`: approximate requests left in this window
- `resetMs`: milliseconds until the current window ends
- `retryAfterMs`: when blocked, how long to wait

`reset(key, windowMs)` deletes a key's counters.

## Concurrency control

`DistributedSemaphore` limits how many executions run at once for a key. The key has `maxConcurrent` slots, each stored as its own key. An execution claims a free slot with a write-if-absent that carries its ticket's time to live (TTL, 300 seconds by default). The slot frees when the ticket is released or its TTL runs out, so a process that dies without calling `release()` holds its slot for the TTL at most. Releasing a ticket after its TTL leaves the slot alone if another execution has taken it since.

When every slot is taken, a caller can wait for one, polling every 100 ms at first and backing off to once a second. If the storage supports publish/subscribe (memory, Redis, and Upstash with publish/subscribe turned on), a released slot wakes waiting callers at once.

```typescript
import { DistributedSemaphore } from '@frontmcp/guard';
import { createMemoryStorage } from '@frontmcp/utils';

const storage = createMemoryStorage();
await storage.connect();
const semaphore = new DistributedSemaphore(storage, 300 /* ticket TTL in seconds */);

const ticket = await semaphore.acquire(
  'my-tool:global', // key
  5, // max concurrent
  10_000, // how long to wait for a slot, in ms (0 = don't wait)
  'my-tool', // name used in error messages
);

if (ticket) {
  try {
    // ... do the work ...
  } finally {
    await ticket.release();
  }
}
```

`acquire` returns `null` when every slot is taken and the wait is `0`, and throws `QueueTimeoutError` when it waited and no slot freed up. `getActiveCount(key)` returns the number of taken slots, and `forceReset(key)` frees every slot.

## Timeout

`withTimeout` runs an async function with a deadline. It passes the function an `AbortSignal` that is aborted when time runs out, and rejects with `ExecutionTimeoutError`. The function keeps running unless it listens to the signal.

```typescript
import { withTimeout } from '@frontmcp/guard';

const response = await withTimeout(
  (signal) => fetch('https://api.example.com/data', { signal }),
  5_000, // timeout in ms
  'fetch-data', // name used in error messages
);
```

## IP filtering

`IpFilter` checks a client IP against allow and deny lists of addresses and CIDR ranges, IPv4 and IPv6. An IPv4-mapped IPv6 address (`::ffff:192.168.1.1`, which a dual-stack socket reports for an IPv4 client) matches as the IPv4 address it maps. Matching uses bigint arithmetic, so it's exact across the whole IPv6 address space.

The deny list is checked first: an IP on it is refused, whatever the allow list says. Then the allow list, then `defaultAction`. An allow list on its own refuses nothing: add `defaultAction: 'deny'` to refuse every other address. A missing or unparseable IP matches no rule and gets `defaultAction`, so `check(undefined)` refuses under `defaultAction: 'deny'`.

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

`isAllowListed(ip)` tells you whether an IP is on the allow list, for example to skip rate limiting for trusted addresses.

## Partition keys

A partition key decides which calls share a rate-limit count or a set of concurrency slots:

| Strategy    | Calls that share a count                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `'global'`  | All of them (the default)                                                                            |
| `'ip'`      | Calls from the same client IP. Without an IP, calls by the same `userId`; without either, one bucket |
| `'session'` | Calls in the same session                                                                            |
| `'userId'`  | Calls by the same authenticated user, or in the same session when there's no user                    |

You can also pass a function of the `PartitionKeyContext`, which has `sessionId` (always set) and optional `clientIp` and `userId`:

```typescript
import type { RateLimitConfig } from '@frontmcp/guard';

const config: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60_000,
  partitionBy: (ctx) => (ctx.userId ? `user:${ctx.userId}` : `session:${ctx.sessionId}`),
};
```

## Guard manager

`GuardManager` combines rate limiting, concurrency control and IP filtering behind one configuration. `createGuardManager` creates its storage and connects it.

The configuration has two levels:

- **Global**, applied to every request: `global` (a rate limit) and `globalConcurrency`.
- **Default**, applied to an entity that doesn't pass its own: `defaultRateLimit`, `defaultConcurrency`, `defaultTimeout`.

A configuration passed for one entity replaces the default; it doesn't add to it.

```typescript
import { createGuardManager } from '@frontmcp/guard';

const guard = await createGuardManager({
  config: {
    enabled: true,
    storage: { type: 'redis', redis: { config: { host: 'localhost', port: 6379 } } },
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
    },
  },
  logger: console,
});

const context = { sessionId: 'sess-1', clientIp: '203.0.113.5' };
const globalRateLimit = await guard.checkGlobalRateLimit(context);
const entityRateLimit = await guard.checkRateLimit('my-tool', undefined, context);
const globalTicket = await guard.acquireGlobalSemaphore(context);
const ticket = await guard.acquireSemaphore('my-tool', undefined, context);

await ticket?.release();
await globalTicket?.release();
await guard.destroy();
```

| Method                                    | Returns                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `checkIpFilter(ip)`                       | An `IpFilterResult`, or `undefined` when there's no `ipFilter`                   |
| `isIpAllowListed(ip)`                     | Whether the IP is on the allow list                                              |
| `checkRateLimit(name, config, context)`   | A `RateLimitResult`. With no `config` and no `defaultRateLimit`, always allowed  |
| `checkGlobalRateLimit(context)`           | A `RateLimitResult` against `global`                                             |
| `acquireSemaphore(name, config, context)` | A `SemaphoreTicket`, or `null` when no slot is free or there's no limit to apply |
| `acquireGlobalSemaphore(context)`         | A `SemaphoreTicket` against `globalConcurrency`, or `null`                       |
| `destroy()`                               | Disconnects the storage                                                          |

The manager doesn't apply `defaultTimeout` itself: read it from `guard.config` and pass it to `withTimeout`.

## Configuration reference

### `GuardConfig`

| Field                | Type                | Default        | Description                                                                     |
| -------------------- | ------------------- | -------------- | ------------------------------------------------------------------------------- |
| `enabled`            | `boolean`           | required       | Whether the guard is on. `@frontmcp/sdk` reads it; `createGuardManager` doesn't |
| `storage`            | `StorageConfig`     | memory         | Storage backend, from `@frontmcp/utils`                                         |
| `keyPrefix`          | `string`            | `'mcp:guard:'` | Prefix for every storage key (a trailing `:` is dropped)                        |
| `global`             | `RateLimitConfig`   | none           | Rate limit for every request                                                    |
| `globalConcurrency`  | `ConcurrencyConfig` | none           | Concurrency limit across every entity                                           |
| `defaultRateLimit`   | `RateLimitConfig`   | none           | Rate limit for entities without their own                                       |
| `defaultConcurrency` | `ConcurrencyConfig` | none           | Concurrency limit for entities without their own                                |
| `defaultTimeout`     | `TimeoutConfig`     | none           | Timeout for entities without their own                                          |
| `ipFilter`           | `IpFilterConfig`    | none           | IP filtering                                                                    |

### `RateLimitConfig`

| Field         | Type           | Default    | Description                   |
| ------------- | -------------- | ---------- | ----------------------------- |
| `maxRequests` | `number`       | required   | Requests allowed per window   |
| `windowMs`    | `number`       | `60000`    | Window length in milliseconds |
| `partitionBy` | `PartitionKey` | `'global'` | Which calls share a count     |

### `ConcurrencyConfig`

| Field            | Type           | Default    | Description                                            |
| ---------------- | -------------- | ---------- | ------------------------------------------------------ |
| `maxConcurrent`  | `number`       | required   | Executions allowed at once                             |
| `queueTimeoutMs` | `number`       | `0`        | How long to wait for a free slot (`0` refuses at once) |
| `partitionBy`    | `PartitionKey` | `'global'` | Which calls share the slots                            |

### `TimeoutConfig`

| Field       | Type     | Default  | Description                            |
| ----------- | -------- | -------- | -------------------------------------- |
| `executeMs` | `number` | required | Maximum execution time in milliseconds |

### `IpFilterConfig`

| Field               | Type                | Default   | Description                                                                                                                                |
| ------------------- | ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `allowList`         | `string[]`          | none      | IP addresses or CIDR ranges to allow                                                                                                       |
| `denyList`          | `string[]`          | none      | IP addresses or CIDR ranges to refuse                                                                                                      |
| `defaultAction`     | `'allow' \| 'deny'` | `'allow'` | What happens to an IP on neither list, or when the client IP isn't known                                                                   |
| `trustProxy`        | `boolean`           | `false`   | Read by `@frontmcp/sdk`, not by `IpFilter`: `true` takes the client IP from `X-Forwarded-For`; `false` leaves it to `FRONTMCP_TRUST_PROXY` |
| `trustedProxyDepth` | `number`            | `1`       | Read by `@frontmcp/sdk` when `trustProxy` is `true`: how many proxies in front of the server append to `X-Forwarded-For`                   |

## Storage

The guard keeps everything behind the `StorageAdapter` interface of `@frontmcp/utils`. `createGuardManager` builds one from `storage` with `createStorage`:

| Backend                                 | Use it for                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Memory (`type: 'memory'`, the default)  | Development, tests and single-process servers. Each process counts on its own        |
| Redis (`type: 'redis'`)                 | Several instances sharing limits. Publish/subscribe wakes callers waiting for a slot |
| Vercel KV (`type: 'vercel-kv'`)         | Servers on Vercel                                                                    |
| Upstash (`type: 'upstash'`)             | Serverless functions: Redis over HTTP, with optional publish/subscribe               |
| Cloudflare KV (`type: 'cloudflare-kv'`) | Cloudflare Workers, with the KV namespace passed in                                  |

`storage` is a `StorageConfig`, such as `{ type: 'redis', redis: { config: { host, port } } }` or `{ type: 'redis', redis: { url } }`. Without `type` it's `'auto'`, which picks a backend from environment variables.

`storage.fallback` decides what happens when the backend can't be reached. With `'error'`, the default in production (`NODE_ENV=production`), `createGuardManager` rejects with `GuardStorageUnavailableError`: rate limits fail closed. With `'memory'`, the default elsewhere, it starts with per-instance counters and logs a warning. The same setting applies if the backend stops answering later: each check then fails with `GuardStorageUnavailableError`, or, with `'memory'`, is served from per-instance counters until the backend answers again.

Keys are written as `<keyPrefix><entity>:<partition>:<kind>:…` with a single `:` after the prefix, for example `mcp:guard:export_tickets:global:rl:…`. Before 1.8.6 the default prefix produced `mcp:guard::export_tickets:…`. Counters written by an older instance aren't read by a newer one, so limits briefly split during a rolling deploy.

## Errors

Every error extends `GuardError`, which has a machine-readable `code` and an HTTP `statusCode`. `instanceof GuardError` also recognizes an error from another copy of this package in the same process.

| Error class                    | Code                        | Status | Thrown by                                                                        |
| ------------------------------ | --------------------------- | ------ | -------------------------------------------------------------------------------- |
| `ExecutionTimeoutError`        | `EXECUTION_TIMEOUT`         | `408`  | `withTimeout`, when time runs out                                                |
| `QueueTimeoutError`            | `QUEUE_TIMEOUT`             | `429`  | `DistributedSemaphore.acquire`, when it waited and no slot freed up              |
| `GuardStorageUnavailableError` | `GUARD_STORAGE_UNAVAILABLE` | `503`  | `createGuardManager` and the manager's checks, when the storage can't be reached |
| `ConcurrencyLimitError`        | `CONCURRENCY_LIMIT`         | `429`  | Your code (and `@frontmcp/sdk`), when `acquireSemaphore` returns `null`          |
| `IpBlockedError`               | `IP_BLOCKED`                | `403`  | Your code, for an IP on the deny list                                            |
| `IpNotAllowedError`            | `IP_NOT_ALLOWED`            | `403`  | Your code, for an IP not on the allow list                                       |

```typescript
import { ExecutionTimeoutError, withTimeout } from '@frontmcp/guard';

try {
  await withTimeout(() => new Promise((resolve) => setTimeout(resolve, 10_000)), 5_000, 'slow-op');
} catch (err) {
  if (err instanceof ExecutionTimeoutError) {
    console.log(err.code); // 'EXECUTION_TIMEOUT'
    console.log(err.statusCode); // 408
    console.log(err.timeoutMs); // 5000
  }
}
```

## API reference

Everything is exported from the package root.

| Kind            | Exports                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classes         | `GuardManager`, `SlidingWindowRateLimiter`, `DistributedSemaphore`, `IpFilter`                                                                                                                                   |
| Functions       | `createGuardManager`, `withTimeout`, `resolvePartitionKey(partitionBy, context)`, `buildStorageKey(entity, partition, suffix?)`                                                                                  |
| Errors          | `GuardError`, `ExecutionTimeoutError`, `ConcurrencyLimitError`, `QueueTimeoutError`, `IpBlockedError`, `IpNotAllowedError`, `GuardStorageUnavailableError`                                                       |
| Zod schemas     | `guardConfigSchema`, `rateLimitConfigSchema`, `concurrencyConfigSchema`, `timeoutConfigSchema`, `ipFilterConfigSchema`, `partitionKeySchema`                                                                     |
| Types           | `GuardConfig`, `GuardLogger`, `GuardManagerOptions`, `CreateGuardManagerArgs`, `RateLimitConfig`, `RateLimitResult`, `ConcurrencyConfig`, `SemaphoreTicket`, `TimeoutConfig`, `IpFilterConfig`, `IpFilterResult` |
| Partition types | `PartitionKey`, `PartitionKeyStrategy`, `CustomPartitionKeyFn`, `PartitionKeyContext`                                                                                                                            |
| Schema inputs   | `GuardConfigInput`, `RateLimitConfigInput`, `ConcurrencyConfigInput`, `TimeoutConfigInput`, `IpFilterConfigInput`                                                                                                |

## Docs

- [Guard options](https://frontmcp.dev/reference/sdk/guard): `rateLimit`, `concurrency`, `timeout` and `throttle` in a FrontMCP server, and the [building blocks](https://frontmcp.dev/reference/sdk/guard#building-blocks) this package exports
- [Limiting and timing out calls](https://frontmcp.dev/learn/limiting-calls): the same options, step by step
- [Error classes](https://frontmcp.dev/reference/sdk/error-classes): the errors a caller gets back

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework that applies these limits to tools and agents
- [`@frontmcp/utils`](https://www.npmjs.com/package/@frontmcp/utils): the storage adapters the guard keeps its counters in

## Contributing

Source: [`libs/guard`](https://github.com/agentfront/frontmcp/tree/main/libs/guard). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
