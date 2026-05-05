// file: libs/adapters/src/skills/bundle/bundle.store.ts

import { diffBundles, type BundleDiff } from './bundle-diff';
import type { ResolvedBundle } from './bundle.types';

/**
 * Bounded vocabulary for the `source` counter / span attribute. Anything
 * outside this set coerces to `'unknown'` to prevent cardinality explosions
 * when callers pass URLs, tenant IDs, or other unbounded strings.
 *
 * Mirrors `KNOWN_BUNDLE_SOURCES` in `@frontmcp/observability`. Inlined to
 * avoid an `@frontmcp/adapters` → `@frontmcp/observability` dependency.
 */
const KNOWN_BUNDLE_SOURCES = ['static', 'npm', 'saas-pull', 'webhook', 'filesystem', 'unknown'] as const;
type KnownBundleSource = (typeof KNOWN_BUNDLE_SOURCES)[number];

function normalizeBundleSource(value: unknown): KnownBundleSource {
  if (typeof value !== 'string') return 'unknown';
  return (KNOWN_BUNDLE_SOURCES as readonly string[]).includes(value) ? (value as KnownBundleSource) : 'unknown';
}

/**
 * Bounded vocabulary for the `reason` counter attribute on swap failures.
 * Untrusted thrown errors can have arbitrary `Error.name` values, so we
 * coerce to a small allowlist instead of echoing them as labels.
 */
type KnownSwapReason = 'pinned' | 'invalid_bundle' | 'listener_error' | 'unknown';

function classifySwapError(err: unknown): KnownSwapReason {
  if (err instanceof BundlePinnedError) return 'pinned';
  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message.toLowerCase();
    if (name === 'BundlePinnedError') return 'pinned';
    if (msg.includes('bundle is required') || msg.includes('malformed')) return 'invalid_bundle';
    if (msg.includes('listener')) return 'listener_error';
  }
  return 'unknown';
}

export type BundleSwapListener = (event: {
  previous: ResolvedBundle | undefined;
  current: ResolvedBundle;
  diff: BundleDiff;
  /** Marker that the swap was triggered by `pin(version)` or `rollback()`. */
  reason?: 'normal' | 'pin' | 'rollback';
}) => void;

/**
 * Minimal telemetry surface the BundleStore needs. Modeled to be a structural
 * subset of `@frontmcp/observability`'s `TelemetryAccessor` so callers can
 * pass that directly, but defined here to keep `@frontmcp/adapters` from
 * picking up a hard dependency on the observability package.
 */
export interface BundleStoreCounter {
  inc(by?: number, attributes?: Record<string, string>): void;
}

export interface BundleStoreSpan {
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  addEvent(name: string, attrs?: Record<string, string | number | boolean>): void;
  recordError?(error: Error): void;
  end(): void;
  endWithError?(error: Error | string): void;
}

export interface BundleStoreTelemetry {
  /** Create (or fetch cached) named counter, e.g. `frontmcp_skills_bundle_pulls_total`. */
  createCounter(name: string, description?: string): BundleStoreCounter;
  /**
   * Start a span. Caller is responsible for `end()` / `endWithError()`.
   * Synchronous — matches the current sync semantics of `swap()`.
   */
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): BundleStoreSpan;
}

/**
 * Options that control the store's history ring buffer and pin behavior.
 */
export interface BundleStoreOptions {
  /**
   * Number of past bundles to retain in memory (in addition to the active one).
   * Used by `pin(version)` and `rollback()`. Default: 3. Must be >= 1.
   */
  historySize?: number;
  /**
   * Optional telemetry hook. When provided, `swap()` is wrapped in a
   * `skill.bundle.swap` span and the bundle-pulls counter is incremented
   * with `{ status, source, reason? }` attributes. When omitted, the store
   * emits no telemetry (zero overhead — no span, no counter).
   */
  telemetry?: BundleStoreTelemetry;
}

interface HistoryEntry {
  bundle: ResolvedBundle;
  /** Timestamp the bundle became active in this process. */
  validatedAt: number;
}

/**
 * In-memory holder for the active bundle plus a small history ring buffer.
 *
 * Atomic swap semantics: `swap()` either fully transitions to the new bundle
 * (and returns the diff) or throws and leaves the previous bundle untouched.
 *
 * Versioning + rollback (v1.2):
 *   - Every successful `swap()` pushes the prior bundle into a fixed-size
 *     history ring (`historySize`). The ring stores entries by version so
 *     `pin(version)` can re-activate any of the last N bundles.
 *   - `pin(version)` snaps the active bundle to a previously-known version,
 *     refuses if the version isn't in history, and marks the store pinned.
 *   - While pinned, `swap()` is rejected (caller decides whether to log/skip
 *     or throw); the existing source listeners keep running so the host
 *     observes new versions arriving but never auto-applies them.
 *   - `rollback()` is sugar for `pin(previousActiveVersion)`.
 *
 * Listeners run synchronously after a successful swap/pin/rollback — keep
 * them cheap.
 */
export class BundleStore {
  private active: ResolvedBundle | undefined;
  private listeners = new Set<BundleSwapListener>();
  private history: HistoryEntry[] = [];
  private pinnedVersion: string | undefined;
  private readonly historySize: number;
  private readonly telemetry: BundleStoreTelemetry | undefined;
  private readonly pullsCounter: BundleStoreCounter | undefined;

  constructor(options: BundleStoreOptions = {}) {
    const requested = options.historySize ?? 3;
    if (!Number.isInteger(requested) || requested < 1) {
      throw new Error('BundleStore: historySize must be a positive integer');
    }
    this.historySize = requested;
    this.telemetry = options.telemetry;
    this.pullsCounter = this.telemetry?.createCounter(
      'frontmcp_skills_bundle_pulls_total',
      'Number of bundle pulls (swaps) attempted, partitioned by status / source.',
    );
  }

  current(): ResolvedBundle | undefined {
    return this.active;
  }

  /**
   * Swap to a new bundle. Returns the structural diff (no-op = same version
   * with no field changes; the swap itself still fires listeners with isNoOp=true
   * so observers can record the heartbeat).
   *
   * Throws when the store is pinned. The caller should check `isPinned()` first
   * if it wants to skip silently rather than throw.
   *
   * @param next   - new bundle to activate
   * @param source - optional source label (e.g. `npm`, `saas-pull`, `webhook`)
   *                 used as a counter / span attribute. When omitted, `unknown`
   *                 is reported.
   */
  swap(next: ResolvedBundle, source?: string): BundleDiff {
    if (!next) {
      throw new Error('BundleStore.swap: bundle is required');
    }
    // Cardinality bound: coerce arbitrary source strings to the small
    // allowlist. Without this, a caller passing a URL or tenant-scoped
    // identifier would create one timeseries per unique value.
    const sourceLabel = normalizeBundleSource(source);
    if (this.telemetry) {
      const span = this.telemetry.startSpan('skill.bundle.swap', {
        source: sourceLabel,
        bundle_id: next.bundleId,
        version: next.version,
        skill_count: next.skills.length,
        ...(this.active?.version ? { from_version: this.active.version } : {}),
      });
      try {
        if (this.pinnedVersion !== undefined) {
          throw new BundlePinnedError(this.pinnedVersion);
        }
        const diff = this.commit(next, 'normal');
        span.setAttributes({ status: 'ok', is_no_op: diff.isNoOp });
        span.end();
        this.pullsCounter?.inc(1, { status: 'ok', source: sourceLabel });
        return diff;
      } catch (err) {
        // Cardinality bound: classify untrusted Error.name into a fixed
        // vocabulary instead of echoing it as a label.
        const reason = classifySwapError(err);
        // M3: pick ONE exception-recording path. `endWithError` already calls
        // `recordException` internally on every implementation we ship — calling
        // both `recordError` AND `endWithError` would emit duplicate exception
        // events. Prefer `endWithError` (which also sets ERROR status); fall
        // back to plain `end()` only when the implementation doesn't expose it.
        if (span.endWithError) {
          span.endWithError(err instanceof Error ? err : String(err));
        } else {
          span.recordError?.(err instanceof Error ? err : new Error(String(err)));
          span.end();
        }
        this.pullsCounter?.inc(1, { status: 'error', source: sourceLabel, reason });
        throw err;
      }
    }
    if (this.pinnedVersion !== undefined) {
      throw new BundlePinnedError(this.pinnedVersion);
    }
    return this.commit(next, 'normal');
  }

  /**
   * Pin the active bundle to a specific historical version. Pinned stores
   * reject `swap()` so source-driven updates accumulate elsewhere without
   * activating. Returns the diff of the swap that activated the pinned
   * version, or undefined if the pinned version was already active.
   *
   * Throws when `version` is unknown to the store's history.
   */
  pin(version: string): BundleDiff | undefined {
    if (this.active && this.active.version === version) {
      this.pinnedVersion = version;
      return undefined;
    }
    const entry = this.history.find((h) => h.bundle.version === version);
    if (!entry) {
      throw new Error(`BundleStore.pin: version "${version}" not in history`);
    }
    const diff = this.commit(entry.bundle, 'pin');
    this.pinnedVersion = version;
    return diff;
  }

  /**
   * Re-activate the most recent bundle in history (the bundle that was
   * active before the current one). Useful after a bad swap is detected.
   * Returns the diff. Throws when no prior bundle is available.
   *
   * Rollback does NOT pin — sources can resume auto-swapping after rollback.
   */
  rollback(): BundleDiff {
    const prior = this.history[this.history.length - 1];
    if (!prior) {
      throw new Error('BundleStore.rollback: no prior bundle in history');
    }
    // Clear pin first so commit() doesn't reject (rollback is an explicit
    // operator action, not a source-driven swap).
    this.pinnedVersion = undefined;
    return this.commit(prior.bundle, 'rollback');
  }

  /** Lift the pin so `swap()` accepts new bundles again. */
  unpin(): void {
    this.pinnedVersion = undefined;
  }

  /** True when the store is currently pinned. */
  isPinned(): boolean {
    return this.pinnedVersion !== undefined;
  }

  /** Pinned version string, or undefined when unpinned. */
  pinned(): string | undefined {
    return this.pinnedVersion;
  }

  /**
   * Snapshot of the history ring (oldest first; does not include the active
   * bundle). Returned array is a shallow copy — safe to inspect.
   */
  historySnapshot(): { version: string; bundleId: string; validatedAt: number }[] {
    return this.history.map((h) => ({
      version: h.bundle.version,
      bundleId: h.bundle.bundleId,
      validatedAt: h.validatedAt,
    }));
  }

  /** Subscribe to swap events. Returns an unsubscribe function. */
  subscribe(fn: BundleSwapListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Reset to empty state. Used by tests. Does NOT fire listeners. */
  reset(): void {
    this.active = undefined;
    this.history = [];
    this.pinnedVersion = undefined;
  }

  /** Commit a new active bundle (shared by swap / pin / rollback). */
  private commit(next: ResolvedBundle, reason: 'normal' | 'pin' | 'rollback'): BundleDiff {
    const previous = this.active;
    const diff = diffBundles(previous, next);

    // Push the outgoing bundle into history if it isn't a duplicate of the
    // most recent entry. Duplicate guard keeps `pin(currentVersion)` from
    // bloating the ring with the same bundle on every call.
    if (previous) {
      const lastInHistory = this.history[this.history.length - 1];
      if (!lastInHistory || lastInHistory.bundle.version !== previous.version) {
        this.history.push({ bundle: previous, validatedAt: Date.now() });
        if (this.history.length > this.historySize) {
          this.history.splice(0, this.history.length - this.historySize);
        }
      }
    }

    this.active = next;
    for (const fn of this.listeners) {
      try {
        fn({ previous, current: next, diff, reason });
      } catch {
        // Listener errors must not poison the swap. They're logged at the call
        // site (sync service) where the logger context is richer.
      }
    }
    return diff;
  }
}

/**
 * Thrown by `BundleStore.swap()` when the store is pinned. Callers that prefer
 * to skip silently should check `isPinned()` before calling swap.
 */
export class BundlePinnedError extends Error {
  constructor(public readonly pinnedVersion: string) {
    super(`BundleStore is pinned to version "${pinnedVersion}"; new swaps are rejected until unpin().`);
    this.name = 'BundlePinnedError';
  }
}
