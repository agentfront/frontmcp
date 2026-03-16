# concurrency

Distributed semaphore for concurrency control, built on the `StorageAdapter` interface.

## How It Works

Each concurrent execution acquires a "ticket":

1. **Acquire**: Atomically increment a counter key (`key:count`) via `incr`. If the new value is at or below `maxConcurrent`, the slot is granted. A unique ticket key (`key:ticket:<uuid>`) is written with a configurable TTL (default: 300 seconds) for crash safety.
2. **Reject/Queue**: If the counter exceeds the limit, it is immediately decremented via `decr`. Depending on `queueTimeoutMs`, the caller is either rejected (returns `null`) or enters a polling queue.
3. **Release**: On release, the ticket key is deleted and the counter is decremented. If the storage backend supports pub/sub, a message is published to `key:released` to wake up any waiting callers.
4. **Crash Safety**: Individual ticket keys have a TTL. If a process dies without releasing, the ticket key expires naturally. The counter may drift but self-corrects as stale tickets expire.

## Queuing Behavior

When `queueTimeoutMs > 0`, the semaphore uses exponential backoff polling (starting at 100ms, capping at 1000ms) to retry acquisition until the deadline. If the storage backend supports pub/sub, slot releases trigger immediate retry via a subscription to the `key:released` channel, reducing latency.

If the deadline passes without acquiring a slot, a `QueueTimeoutError` is thrown.

## Exports

- `DistributedSemaphore` -- the semaphore class
- `ConcurrencyConfig` -- configuration type (`maxConcurrent`, `queueTimeoutMs`, `partitionBy`)
- `SemaphoreTicket` -- returned on successful acquire; call `ticket.release()` when done

## Usage

```typescript
import { DistributedSemaphore } from '@frontmcp/guard';

const semaphore = new DistributedSemaphore(storageAdapter, 300);

const ticket = await semaphore.acquire('my-tool:global', 5, 10_000, 'my-tool');
if (!ticket) {
  // All slots full and queueTimeoutMs was 0
  return;
}
try {
  await doWork();
} finally {
  await ticket.release();
}

// Inspect active count
const active = await semaphore.getActiveCount('my-tool:global');

// Emergency reset (clears counter and all ticket keys)
await semaphore.forceReset('my-tool:global');
```

## Storage Requirements

The semaphore calls `incr`, `decr`, `set` (with TTL), `get`, `delete`, `keys`, `mdelete`, and optionally `publish`/`subscribe` on the storage adapter.
