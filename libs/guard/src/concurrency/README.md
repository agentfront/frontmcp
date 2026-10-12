# concurrency

Distributed semaphore for concurrency control, built on the `StorageAdapter` interface.

## How It Works

Each concurrent execution holds one of `maxConcurrent` slots, stored as `key:slot:<n>`:

1. **Acquire**: Read every slot key with one `mget`, then claim a free one with `set` (`ifNotExists`, with the ticket TTL, default 300 seconds) and read it back to confirm the ticket won it. Another caller that claimed the same slot first sends this one to the next free slot.
2. **Reject/Queue**: If no slot is free, the caller is either rejected (returns `null`) or enters a polling queue, depending on `queueTimeoutMs`.
3. **Hold**: While the ticket is held, its slot's TTL is renewed every third of the TTL (`expireIfEquals`, which renews only a slot that still holds this ticket). An execution that runs longer than the TTL keeps its slot.
4. **Release**: On release, the renewal stops and the slot key is deleted only while it still holds this ticket (`deleteIfEquals`). If the storage backend supports pub/sub, a message is published to `key:released` to wake up any waiting callers.
5. **Crash Safety**: A process that dies stops renewing, so its slot key expires with the TTL and the slot is free again.

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

// Emergency reset (frees every slot)
await semaphore.forceReset('my-tool:global');
```

## Storage Requirements

The semaphore calls `mget`, `set` (with TTL and `ifNotExists`), `get`, `deleteIfEquals`, `expireIfEquals`, `keys`, `mdelete`, and optionally `publish`/`subscribe` on the storage adapter. `deleteIfEquals` and `expireIfEquals` must be atomic (memory, Redis, Upstash and Vercel KV); with an adapter that lacks them, `acquire()` throws `GuardStorageUnsupportedError` before it claims a slot.
