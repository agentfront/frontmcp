// file: libs/adapters/src/skills/security/webhook-replay-guard.ts
//
// Timestamp-window and nonce replay checks for bundle pushes: the `saas` source checks each push token's `iat` and `jti`.

import { sha256Hex } from '@frontmcp/utils';

import { MemoryReplayNonceStore, type ReplayNonceStore } from './replay-nonce-store';

/** Why a check refused: also the `reason` label of `frontmcp_skills_replay_rejects_total`. */
export type ReplayRejectCode =
  | 'invalid_timestamp'
  | 'invalid_nonce'
  | 'outside_window'
  | 'nonce_replay'
  | 'store_unavailable';

export interface ReplayCheckResult {
  ok: boolean;
  reason?: string;
  code?: ReplayRejectCode;
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
  /** Max nonces the default in-memory store tracks simultaneously (default 5_000). */
  capacity?: number;
  /**
   * Where the accepted nonces are recorded. Default: this process's memory, which replicas and Worker isolates don't
   * share. Give every instance that serves the server the same store.
   */
  store?: ReplayNonceStore;
  /**
   * Optional telemetry hook. When provided, every `check()` rejection is
   * recorded against `frontmcp_skills_replay_rejects_total` with a low-cardinality
   * `{ reason }` attribute. When omitted, the guard emits no telemetry.
   */
  telemetry?: ReplayGuardTelemetry;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

export class WebhookReplayGuard {
  private readonly windowMs: number;
  private readonly store: ReplayNonceStore;
  private now: () => number = Date.now;
  private readonly rejectsCounter: ReplayGuardCounter | undefined;
  private readonly checksCounter: ReplayGuardCounter | undefined;

  constructor(options: WebhookReplayGuardOptions = {}) {
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('WebhookReplayGuard: windowMs must be a finite number > 0');
    }
    if (options.capacity !== undefined && (!Number.isInteger(options.capacity) || options.capacity <= 0)) {
      throw new RangeError('WebhookReplayGuard: capacity must be a positive integer');
    }
    this.windowMs = windowMs;
    this.store = options.store ?? new MemoryReplayNonceStore({ capacity: options.capacity, now: () => this.now() });
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
   * Check that a (timestamp, nonce) pair is fresh and unseen, and record the nonce. Returns ok=false if the timestamp
   * is outside the freshness window, the nonce was already recorded within that window, or the store failed.
   */
  async check(args: { timestampMs: number; nonce: string }): Promise<ReplayCheckResult> {
    const { timestampMs, nonce } = args;
    const reject = (code: ReplayRejectCode, reason: string): ReplayCheckResult => {
      this.rejectsCounter?.inc(1, { reason: code });
      this.checksCounter?.inc(1, { status: 'error' });
      return { ok: false, reason, code };
    };
    if (!Number.isFinite(timestampMs)) {
      return reject('invalid_timestamp', 'timestamp not finite');
    }
    if (typeof nonce !== 'string' || nonce.length < 8) {
      return reject('invalid_nonce', 'nonce too short');
    }

    const now = this.now();
    if (Math.abs(now - timestampMs) > this.windowMs) {
      return reject('outside_window', `timestamp outside ${this.windowMs}ms window`);
    }

    // Dedupe by nonce, NOT by (timestamp, nonce): keying on the tuple would let an attacker reuse a nonce by varying
    // the in-window timestamp. The nonce stays recorded until its timestamp leaves the window.
    let claimed: boolean;
    try {
      claimed = await this.store.claim(sha256Hex(nonce), timestampMs + this.windowMs - now);
    } catch (error) {
      return reject('store_unavailable', `the replay store failed: ${(error as Error).message}`);
    }
    if (!claimed) {
      return reject('nonce_replay', 'nonce replay detected within freshness window');
    }
    this.checksCounter?.inc(1, { status: 'ok' });
    return { ok: true };
  }
}
