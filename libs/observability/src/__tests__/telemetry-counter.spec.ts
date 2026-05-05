import {
  _resetCounterCacheForTesting,
  createCounter,
  getCounterTotal,
  getMetricSnapshot,
  KNOWN_BUNDLE_SOURCES,
  KNOWN_ERROR_REASONS,
  normalizeBundleSource,
  normalizeErrorReason,
  resetCounterCacheForTesting,
  resetMetricSnapshot,
  resetTelemetrySnapshotForTesting,
} from '../telemetry/telemetry.counters';

describe('TelemetryCounter', () => {
  beforeEach(() => {
    resetMetricSnapshot();
    _resetCounterCacheForTesting();
  });

  it('increments by 1 by default', () => {
    const counter = createCounter('frontmcp_test_total', 'test counter');
    counter.inc();
    counter.inc();
    expect(getCounterTotal('frontmcp_test_total')).toBe(2);
  });

  it('increments by N when given an explicit value', () => {
    const counter = createCounter('frontmcp_test_n_total');
    counter.inc(5);
    expect(getCounterTotal('frontmcp_test_n_total')).toBe(5);
  });

  it('partitions counts by attribute combination', () => {
    const counter = createCounter('frontmcp_test_attrs_total');
    counter.inc(1, { status: 'ok' });
    counter.inc(1, { status: 'ok' });
    counter.inc(1, { status: 'error' });

    const snap = getMetricSnapshot().filter((e) => e.name === 'frontmcp_test_attrs_total');
    const ok = snap.find((e) => e.attributes['status'] === 'ok');
    const err = snap.find((e) => e.attributes['status'] === 'error');
    expect(ok?.count).toBe(2);
    expect(err?.count).toBe(1);
  });

  it('treats attribute order as irrelevant for snapshot grouping', () => {
    const counter = createCounter('frontmcp_test_order_total');
    counter.inc(1, { a: '1', b: '2' });
    counter.inc(1, { b: '2', a: '1' });

    const snap = getMetricSnapshot().filter((e) => e.name === 'frontmcp_test_order_total');
    expect(snap).toHaveLength(1);
    expect(snap[0].count).toBe(2);
  });

  it('returns the same handle for repeated createCounter calls (cache)', () => {
    const a = createCounter('frontmcp_dup_total');
    const b = createCounter('frontmcp_dup_total');
    expect(a).toBe(b);
  });

  it('silently ignores invalid increments (negative / NaN)', () => {
    const counter = createCounter('frontmcp_test_invalid_total');
    counter.inc(-1);
    counter.inc(Number.NaN);
    expect(getCounterTotal('frontmcp_test_invalid_total')).toBe(0);
  });

  it('exposes a name property matching the create argument', () => {
    const counter = createCounter('frontmcp_named_total');
    expect(counter.name).toBe('frontmcp_named_total');
  });

  it('returns a fresh array from getMetricSnapshot (no leakage)', () => {
    const counter = createCounter('frontmcp_iso_total');
    counter.inc();
    const snap = getMetricSnapshot();
    snap.push({ name: 'fake', count: 999, attributes: {} });
    const snap2 = getMetricSnapshot();
    expect(snap2.find((e) => e.name === 'fake')).toBeUndefined();
  });

  it('resetMetricSnapshot() clears recorded counts', () => {
    const counter = createCounter('frontmcp_reset_total');
    counter.inc(3);
    expect(getCounterTotal('frontmcp_reset_total')).toBe(3);
    resetMetricSnapshot();
    expect(getCounterTotal('frontmcp_reset_total')).toBe(0);
    // Counter handle still works after snapshot reset.
    counter.inc();
    expect(getCounterTotal('frontmcp_reset_total')).toBe(1);
  });

  describe('snapshot reset isolation', () => {
    // Without an explicit reset, the process-global snapshot store leaks
    // increments from one spec into the next. The aliases below make the
    // intent obvious in test code.
    it('resetTelemetrySnapshotForTesting clears the snapshot the same way as resetMetricSnapshot', () => {
      const counter = createCounter('frontmcp_iso_a_total');
      counter.inc(2);
      expect(getCounterTotal('frontmcp_iso_a_total')).toBe(2);
      resetTelemetrySnapshotForTesting();
      expect(getCounterTotal('frontmcp_iso_a_total')).toBe(0);
    });

    it('resetCounterCacheForTesting forgets cached counter handles so the same name can be re-created', () => {
      const a = createCounter('frontmcp_cache_total', 'first description');
      resetCounterCacheForTesting();
      const b = createCounter('frontmcp_cache_total', 'second description');
      expect(a).not.toBe(b);
    });
  });

  describe('OTel-not-installed fallback', () => {
    // The default OTel `metrics` API returns a no-op meter when no
    // MeterProvider is registered. The snapshot store records every increment
    // independently of the meter, so counters remain observable to tests and
    // operator health-checks even without a wired exporter.
    it('records increments in the snapshot even when no MeterProvider is registered', () => {
      // No meter setup performed here — `metrics.getMeter` returns the global
      // no-op meter from `@opentelemetry/api`. The snapshot path must still
      // record the increment.
      const counter = createCounter('frontmcp_noop_meter_total');
      counter.inc(1, { status: 'ok' });
      counter.inc(2, { status: 'error' });
      expect(getCounterTotal('frontmcp_noop_meter_total')).toBe(3);
      const snap = getMetricSnapshot().filter((e) => e.name === 'frontmcp_noop_meter_total');
      expect(snap).toHaveLength(2);
    });
  });

  describe('cardinality bounding', () => {
    it('normalizeBundleSource passes through known sources', () => {
      for (const v of KNOWN_BUNDLE_SOURCES) {
        expect(normalizeBundleSource(v)).toBe(v);
      }
    });

    it('normalizeBundleSource coerces unknown values to "unknown"', () => {
      expect(normalizeBundleSource('https://attacker.example.com/path')).toBe('unknown');
      expect(normalizeBundleSource('webhook')).toBe('unknown');
      expect(normalizeBundleSource('')).toBe('unknown');
      expect(normalizeBundleSource(undefined)).toBe('unknown');
      expect(normalizeBundleSource(null)).toBe('unknown');
      expect(normalizeBundleSource(42)).toBe('unknown');
      expect(normalizeBundleSource({})).toBe('unknown');
    });

    it('normalizeErrorReason returns a value from the known vocabulary', () => {
      const network = new Error('ECONNREFUSED 127.0.0.1:9999');
      const timeout = new Error('Request timed out after 30s');
      const parse = new SyntaxError('Unexpected token < in JSON');
      const range = new RangeError('Value out of range');
      const unknown = new Error('something happened');
      for (const reason of [network, timeout, parse, range, unknown].map((e) => normalizeErrorReason(e))) {
        expect(KNOWN_ERROR_REASONS).toContain(reason);
      }
    });

    it('normalizeErrorReason maps timeout and network errors specifically', () => {
      expect(normalizeErrorReason(new Error('Request timed out'))).toBe('timeout');
      expect(normalizeErrorReason(new Error('ECONNRESET'))).toBe('network');
      expect(normalizeErrorReason(new SyntaxError('parse failed'))).toBe('parse_error');
      expect(normalizeErrorReason(undefined)).toBe('unknown');
      expect(normalizeErrorReason(null)).toBe('unknown');
    });
  });
});
