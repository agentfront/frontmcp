// file: plugins/plugin-skilled-openapi/src/executor/host-concurrency.ts
//
// Per-host outbound concurrency limiter (SECURITY-REVIEW B6). `outbound.
// maxConcurrencyPerHost` was advertised in the schema but never enforced —
// a workflow (or a burst of them) could open unbounded simultaneous sockets to
// one upstream. This bounds the number of in-flight requests per host.
//
// State is module-level and therefore PER-ISOLATE — it caps concurrency from a
// single runtime instance, not a cluster-wide rate limit. That is the correct
// scope for "don't let one instance hammer one host"; cross-instance limits
// belong to an external gateway.
//
// The slot is *transferred* to the next waiter on release (active count is not
// dropped to zero while waiters remain), so the limit is never transiently
// exceeded by a racing acquirer.

interface HostGate {
  active: number;
  queue: Array<() => void>;
}

const gates = new Map<string, HostGate>();

/**
 * Run `fn` while holding one of at most `limit` concurrent slots for `host`.
 * A non-positive / non-finite `limit` disables the gate (runs immediately).
 * The slot is always released in `finally`, including when `fn` throws.
 */
export async function withHostConcurrency<T>(host: string, limit: number, fn: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(limit) || limit <= 0) {
    return fn();
  }

  let gate = gates.get(host);
  if (!gate) {
    gate = { active: 0, queue: [] };
    gates.set(host, gate);
  }

  if (gate.active >= limit) {
    // Wait for a slot. The releaser hands its slot to us WITHOUT decrementing
    // `active`, so once resumed we already hold a slot.
    await new Promise<void>((resolve) => gate!.queue.push(resolve));
  } else {
    gate.active += 1;
  }

  try {
    return await fn();
  } finally {
    const next = gate.queue.shift();
    if (next) {
      // Transfer our slot to the next waiter; `active` stays constant.
      next();
    } else {
      gate.active -= 1;
      // Drop empty gates so the map can't grow without bound across hosts.
      if (gate.active <= 0 && gate.queue.length === 0) {
        gates.delete(host);
      }
    }
  }
}

/** Test-only: reset all gates. */
export function __resetHostConcurrencyForTests(): void {
  gates.clear();
}
