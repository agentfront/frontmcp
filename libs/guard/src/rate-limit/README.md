# rate-limit

Sliding window counter rate limiter built on the `StorageAdapter` interface.

## Algorithm

The **sliding window counter** maintains two fixed-window counters for adjacent time windows. When a request arrives at time `t`:

1. Determine the current window start: `floor(t / windowMs) * windowMs`.
2. Load the counters for the current and previous windows via a single `mget` call.
3. Compute a weighted estimate: `previousCount * (1 - elapsed/windowMs) + currentCount`.
4. If the estimate exceeds `maxRequests`, reject the request and return `retryAfterMs`.
5. Otherwise, atomically increment the current window counter via `incr` and set a TTL of `2 * windowMs` so stale keys are garbage-collected.

This approach uses O(1) storage per partition key (two counter keys at most) and avoids the burst edges that occur with simple fixed-window counters.

## Exports

- `SlidingWindowRateLimiter` -- the rate limiter class
- `RateLimitConfig` -- configuration type (`maxRequests`, `windowMs`, `partitionBy`)
- `RateLimitResult` -- result type (`allowed`, `remaining`, `resetMs`, `retryAfterMs`)

## Usage

```typescript
import { SlidingWindowRateLimiter } from '@frontmcp/guard';

const limiter = new SlidingWindowRateLimiter(storageAdapter);

// Check and increment
const result = await limiter.check('user:42', 100, 60_000);
if (!result.allowed) {
  // Reject -- result.retryAfterMs tells the caller when to retry
}

// Reset counters for a key
await limiter.reset('user:42', 60_000);
```

## Storage Requirements

The limiter calls `mget`, `incr`, and `expire` on the storage adapter. Any backend that implements these operations (Memory, Redis, Vercel KV, Upstash) is compatible.
