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

/**
 * Minimal telemetry surface for replay rejects. Structurally compatible
 * with `@frontmcp/observability`'s `TelemetryAccessor` so callers can pass
 * that directly while keeping this module dependency-free.
 */
export interface ReplayGuardCounter {
  inc(by?: number, attributes?: Record<string, string>): void;
}
export interface ReplayGuardTelemetry {
  createCounter(name: string, description?: string): ReplayGuardCounter;
}

export interface WebhookReplayGuardOptions {
  /** Allowed clock skew window in ms (default 300_000 = 5min). */
  windowMs?: number;
  /** Max nonces tracked simultaneously (default 5_000). */
  capacity?: number;
  /**
   * Optional telemetry hook. When provided, every `check()` rejection is
   * recorded against `frontmcp_skills_replay_rejects_total` with a low-cardinality
   * `{ reason }` attribute. When omitted, the guard emits no telemetry.
   */
  telemetry?: ReplayGuardTelemetry;
}

/**
 * Map a free-text reject reason to a low-cardinality counter label.
 */
function classifyReplayReason(reason: string): string {
  if (reason.includes('not finite')) return 'invalid_timestamp';
  if (reason.includes('too short')) return 'invalid_nonce';
  if (reason.includes('outside')) return 'outside_window';
  if (reason.includes('replay')) return 'nonce_replay';
  return 'other';
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_CAPACITY = 5_000;

export class WebhookReplayGuard {
  private readonly windowMs: number;
  private readonly capacity: number;
  private readonly seen = new Map<string, number>();
  private now: () => number = Date.now;
  private readonly rejectsCounter: ReplayGuardCounter | undefined;
  private readonly checksCounter: ReplayGuardCounter | undefined;

  constructor(options: WebhookReplayGuardOptions = {}) {
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('WebhookReplayGuard: windowMs must be a finite number > 0');
    }
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('WebhookReplayGuard: capacity must be a positive integer');
    }
    this.windowMs = windowMs;
    this.capacity = capacity;
    // Two counters mirror the bundle-pulls / signature-verifications
    // pattern: the failure counter has a `reason` label; a `_checks_total`
    // counter tracks every call so operators can compute reject-rate from
    // a single timeseries source.
    this.rejectsCounter = options.telemetry?.createCounter(
      'frontmcp_skills_replay_rejects_total',
      'Number of webhook replay-guard rejections, partitioned by reason.',
    );
    this.checksCounter = options.telemetry?.createCounter(
      'frontmcp_skills_replay_checks_total',
      'Number of webhook replay-guard checks, partitioned by status (ok|error).',
    );
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
    const reject = (reason: string): ReplayCheckResult => {
      this.rejectsCounter?.inc(1, { reason: classifyReplayReason(reason) });
      this.checksCounter?.inc(1, { status: 'error' });
      return { ok: false, reason };
    };
    if (!Number.isFinite(timestampMs)) {
      return reject('timestamp not finite');
    }
    if (typeof nonce !== 'string' || nonce.length < 8) {
      return reject('nonce too short');
    }

    const now = this.now();
    if (Math.abs(now - timestampMs) > this.windowMs) {
      return reject(`timestamp outside ${this.windowMs}ms window`);
    }

    // Dedupe by nonce, NOT by (timestamp, nonce). The class contract is "the
    // same nonce can't be replayed within the window"; keying on the tuple
    // would let an attacker reuse a nonce by varying the in-window timestamp
    // header (relevant when timestamps aren't independently bound by the
    // outer JWT signature).
    const key = sha256Hex(nonce);
    const expiresAt = this.seen.get(key);
    // Boundary handling: a nonce is considered fresh while expiresAt >= now.
    // Using strict `>` here paired with `<=` in prune() left a one-tick window
    // (abs(now - timestampMs) === windowMs) where a nonce could be accepted
    // and then immediately replayed. Treat the boundary as still-tracked.
    if (expiresAt !== undefined && expiresAt >= now) {
      return reject('nonce replay detected within freshness window');
    }

    // Capacity eviction: drop expired entries first; if still at capacity,
    // evict the entry with the SMALLEST `expiresAt` — Map insertion order
    // does not reliably correlate with expiry because the supplied
    // `timestampMs` can be older or newer than `now`, so insertion-order
    // eviction can drop a still-fresh nonce while leaving expired ones live.
    if (this.seen.size >= this.capacity) {
      this.prune();
    }
    if (this.seen.size >= this.capacity) {
      let victimKey: string | undefined;
      let victimExpiry = Number.POSITIVE_INFINITY;
      for (const [candidateKey, candidateExpiry] of this.seen) {
        if (candidateExpiry < victimExpiry) {
          victimKey = candidateKey;
          victimExpiry = candidateExpiry;
        }
      }
      if (victimKey !== undefined) this.seen.delete(victimKey);
    }
    this.seen.set(key, timestampMs + this.windowMs);
    this.checksCounter?.inc(1, { status: 'ok' });
    return { ok: true };
  }

  /** Test/maintenance helper: drop expired entries proactively. */
  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [k, expiresAt] of this.seen) {
      if (expiresAt < now) {
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
