/**
 * TelemetryCounter — minimal counter abstraction for FrontMCP.
 *
 * Backed by `@opentelemetry/api` `metrics.getMeter(...)` so installations
 * that wire up an OTel MeterProvider get real counter exports. Independently,
 * every increment is also recorded in an in-memory snapshot store so tests
 * (and operators without a configured meter provider) can introspect counter
 * activity without standing up a full OTel pipeline.
 *
 * IMPORTANT: ObservabilityPlugin does NOT register a `MeterProvider` — it only
 * wires up tracing. To export counters to a real metrics backend (Prometheus,
 * OTLP, etc.) the host application must call `metrics.setGlobalMeterProvider()`
 * with its own configured `MeterProvider`. Without that step, counters are
 * observable only via `getMetricSnapshot()` / `getCounterTotal()`.
 *
 * Naming convention follows OTel-style snake_case with a `_total` suffix:
 *   - `frontmcp_skills_bundle_pulls_total`
 *   - `frontmcp_skills_signature_failures_total`
 *   - `frontmcp_skills_signature_verifications_total`
 *   - `frontmcp_skills_replay_rejects_total`
 *   - `frontmcp_skills_replay_checks_total`
 *
 * Attributes should be lowercase snake_case and bounded cardinality
 * (e.g. `status`, `source`, `reason`).
 *
 * Bounded vocabularies (enforced by helpers below):
 *   - `source`: 'static' | 'npm' | 'saas-pull' | 'filesystem' | 'unknown'
 *   - `reason` (errors): 'network' | 'timeout' | 'invalid_response' |
 *                        'parse_error' | 'unknown'
 *   - `status`: 'ok' | 'error'
 *
 * Anything outside the whitelist coerces to `'unknown'` (or `'other'` for
 * subsystem-specific reason classifiers like `classifyReason()` in
 * bundle-signature.ts) so untrusted input cannot create unbounded label
 * cardinality.
 */

import { metrics, type Counter as OTelCounter } from '@opentelemetry/api';

/**
 * Public counter handle — increments propagate to both the OTel meter
 * (when configured) and the in-memory snapshot store.
 */
export interface TelemetryCounter {
  /**
   * Increment the counter.
   *
   * @param by - amount to add (default 1, must be >= 0)
   * @param attributes - bounded-cardinality labels
   */
  inc(by?: number, attributes?: Record<string, string>): void;

  /** The metric name, useful for diagnostics/snapshot keys. */
  readonly name: string;
}

interface SnapshotEntry {
  name: string;
  count: number;
  attributes: Record<string, string>;
}

/**
 * Stable, deterministic key for a (name, attributes) tuple. Sorting keys
 * keeps the snapshot independent of attribute insertion order.
 */
function snapshotKey(name: string, attributes: Record<string, string>): string {
  const keys = Object.keys(attributes).sort();
  if (keys.length === 0) return name;
  const tail = keys.map((k) => `${k}=${attributes[k]}`).join(',');
  return `${name}{${tail}}`;
}

const snapshotStore = new Map<string, SnapshotEntry>();

class TelemetryCounterImpl implements TelemetryCounter {
  constructor(
    public readonly name: string,
    private readonly otelCounter: OTelCounter,
  ) {}

  inc(by = 1, attributes: Record<string, string> = {}): void {
    if (!Number.isFinite(by) || by < 0) {
      // Counters are non-negative monotonic per OTel spec — silently ignore
      // bad input rather than throwing from a telemetry hot path.
      return;
    }
    try {
      this.otelCounter.add(by, attributes);
    } catch {
      // Telemetry must never break the caller. Snapshot still records.
    }
    const key = snapshotKey(this.name, attributes);
    const existing = snapshotStore.get(key);
    if (existing) {
      existing.count += by;
    } else {
      snapshotStore.set(key, { name: this.name, count: by, attributes: { ...attributes } });
    }
  }
}

const METER_NAME = '@frontmcp/observability';
const counterCache = new Map<string, TelemetryCounter>();

/**
 * Create (or retrieve cached) named counter.
 *
 * Counters with the same name are de-duped — subsequent calls return the
 * same handle. This prevents accidentally exporting two counters with the
 * same name but slightly different descriptions.
 */
export function createCounter(name: string, description?: string): TelemetryCounter {
  const existing = counterCache.get(name);
  if (existing) return existing;

  const meter = metrics.getMeter(METER_NAME);
  const otelCounter = meter.createCounter(name, description ? { description } : undefined);
  const counter = new TelemetryCounterImpl(name, otelCounter);
  counterCache.set(name, counter);
  return counter;
}

/**
 * Snapshot of all counters recorded since process start (or last reset).
 * Useful for assertions in tests.
 *
 * Each entry is a (name, attributes, count) tuple. Counters with attributes
 * are reported per unique attribute combination.
 */
export interface CounterSnapshotEntry {
  name: string;
  count: number;
  attributes: Record<string, string>;
}

/**
 * Read a snapshot of every counter increment recorded so far. Returned
 * array is a fresh copy — mutating it does not affect the store.
 */
export function getMetricSnapshot(): CounterSnapshotEntry[] {
  return Array.from(snapshotStore.values()).map((entry) => ({
    name: entry.name,
    count: entry.count,
    attributes: { ...entry.attributes },
  }));
}

/**
 * Lookup helper — sum of all increments for a given counter name (across
 * every attribute combination).
 */
export function getCounterTotal(name: string): number {
  let sum = 0;
  for (const entry of snapshotStore.values()) {
    if (entry.name === name) sum += entry.count;
  }
  return sum;
}

/**
 * Test helper — clear the in-memory snapshot store. Does not reset the
 * underlying OTel meter (which has its own lifecycle).
 *
 * @deprecated Prefer {@link resetTelemetrySnapshotForTesting}, which is
 * spelled to make its test-only intent explicit. Kept for backwards
 * compatibility.
 */
export function resetMetricSnapshot(): void {
  snapshotStore.clear();
}

/**
 * Test helper — clear the in-memory snapshot store between specs to prevent
 * cross-test leakage. The snapshot store is process-global; without an
 * explicit reset between tests, counter increments from one spec can show
 * up in another's assertions.
 *
 * @internal Test-only API. Production code MUST NOT call this.
 */
export function resetTelemetrySnapshotForTesting(): void {
  snapshotStore.clear();
}

/**
 * Test helper — clear the counter cache. Used only by tests that need to
 * exercise the create-path repeatedly.
 *
 * @internal Test-only API. Production code MUST NOT call this.
 */
export function resetCounterCacheForTesting(): void {
  counterCache.clear();
}

/**
 * @deprecated Use {@link resetCounterCacheForTesting} instead. The leading
 * underscore violates project naming conventions (CLAUDE.md). Kept temporarily
 * for backwards compatibility with existing specs.
 */
export const _resetCounterCacheForTesting = resetCounterCacheForTesting;

/**
 * Bounded vocabulary for the `source` counter attribute. Anything outside
 * this set is coerced to `'unknown'` to prevent cardinality explosions when
 * upstream callers pass URLs, tenant IDs, or other unbounded strings.
 */
export const KNOWN_BUNDLE_SOURCES = ['static', 'npm', 'saas-pull', 'filesystem', 'unknown'] as const;
export type KnownBundleSource = (typeof KNOWN_BUNDLE_SOURCES)[number];

/**
 * Coerce a free-text source label to the bounded `KnownBundleSource` set.
 * Unknown / undefined / non-string inputs map to `'unknown'`.
 */
export function normalizeBundleSource(value: unknown): KnownBundleSource {
  if (typeof value !== 'string') return 'unknown';
  return (KNOWN_BUNDLE_SOURCES as readonly string[]).includes(value) ? (value as KnownBundleSource) : 'unknown';
}

/**
 * Bounded vocabulary for `reason` counter attributes derived from generic
 * errors. Subsystem-specific classifiers (e.g. signature/replay) MAY define
 * their own narrower vocabularies, but should use this one for catch-all
 * "an Error was thrown" paths.
 */
export const KNOWN_ERROR_REASONS = ['network', 'timeout', 'invalid_response', 'parse_error', 'unknown'] as const;
export type KnownErrorReason = (typeof KNOWN_ERROR_REASONS)[number];

/**
 * Map an arbitrary error to a low-cardinality `reason` label. Inspects the
 * error name and a small substring of the message — never echoes the raw
 * message back as a label, which would let untrusted error sources spawn
 * unbounded timeseries.
 */
export function normalizeErrorReason(err: unknown): KnownErrorReason {
  if (!err) return 'unknown';
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const haystack = `${name} ${message}`.toLowerCase();
  if (name === 'TimeoutError' || haystack.includes('timeout') || haystack.includes('timed out')) {
    return 'timeout';
  }
  if (
    name === 'NetworkError' ||
    name === 'FetchError' ||
    haystack.includes('network') ||
    haystack.includes('econnrefused') ||
    haystack.includes('econnreset') ||
    haystack.includes('enotfound') ||
    haystack.includes('socket') ||
    haystack.includes('dns')
  ) {
    return 'network';
  }
  if (name === 'SyntaxError' || haystack.includes('parse') || haystack.includes('json')) {
    return 'parse_error';
  }
  if (
    name === 'TypeError' ||
    name === 'RangeError' ||
    haystack.includes('invalid') ||
    haystack.includes('malformed') ||
    haystack.includes('schema')
  ) {
    return 'invalid_response';
  }
  return 'unknown';
}
