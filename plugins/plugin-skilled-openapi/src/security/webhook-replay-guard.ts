// file: plugins/plugin-skilled-openapi/src/security/webhook-replay-guard.ts
//
// Replay protection for the SaaS-push webhook channel. Each request must
// carry a `X-Frontmcp-Push-Nonce` and a `X-Frontmcp-Push-Timestamp` header
// signed via the inbound JWT (binding signature → nonce). This guard:
//
//   1. Rejects timestamps outside `windowMs` (default ±5min).
//   2. Tracks nonces in an LRU set so the same nonce can't be replayed within
//      the window. Set capacity is bounded to prevent unbounded memory growth.
//
// The guard does NOT verify the signature itself — that's the JwtVerifier's
// job — it only enforces freshness and uniqueness.

import { sha256Hex } from '@frontmcp/utils';

export interface ReplayCheckResult {
  ok: boolean;
  reason?: string;
}

export interface WebhookReplayGuardOptions {
  /** Allowed clock skew window in ms (default 300_000 = 5min). */
  windowMs?: number;
  /** Max nonces tracked simultaneously (default 5_000). */
  capacity?: number;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_CAPACITY = 5_000;

export class WebhookReplayGuard {
  private readonly windowMs: number;
  private readonly capacity: number;
  private readonly seen = new Map<string, number>();
  private now: () => number = Date.now;

  constructor(options: WebhookReplayGuardOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
  }

  /** For tests: override the time source. */
  setNowProvider(fn: () => number): void {
    this.now = fn;
  }

  /**
   * Check that a (timestamp, nonce) pair is fresh and unseen. Returns ok=false
   * if the timestamp is outside the freshness window or the nonce has already
   * been observed within that window.
   */
  check(args: { timestampMs: number; nonce: string }): ReplayCheckResult {
    const { timestampMs, nonce } = args;
    if (!Number.isFinite(timestampMs)) {
      return { ok: false, reason: 'timestamp not finite' };
    }
    if (typeof nonce !== 'string' || nonce.length < 8) {
      return { ok: false, reason: 'nonce too short' };
    }

    const now = this.now();
    if (Math.abs(now - timestampMs) > this.windowMs) {
      return { ok: false, reason: `timestamp outside ${this.windowMs}ms window` };
    }

    // Cheap canonical key — sha256 the (ts, nonce) tuple to bound key size.
    const key = sha256Hex(`${timestampMs}|${nonce}`);
    const expiresAt = this.seen.get(key);
    if (expiresAt !== undefined && expiresAt > now) {
      return { ok: false, reason: 'nonce replay detected within freshness window' };
    }

    // LRU eviction: when capacity is hit, drop the oldest entry by Map insertion
    // order (Maps preserve insertion order). Re-adding moves to end implicitly.
    if (this.seen.size >= this.capacity) {
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
    this.seen.set(key, timestampMs + this.windowMs);
    return { ok: true };
  }

  /** Test/maintenance helper: drop expired entries proactively. */
  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [k, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /** Inspect: number of nonces currently tracked. */
  get size(): number {
    return this.seen.size;
  }
}
