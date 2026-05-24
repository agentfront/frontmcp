import { PROMETHEUS_CONTENT_TYPE, renderJsonExposition, renderPrometheusExposition } from '../render';

describe('renderPrometheusExposition (issue #397)', () => {
  it('returns empty string for empty input', () => {
    expect(renderPrometheusExposition([])).toBe('');
    expect(renderPrometheusExposition([], [])).toBe('');
  });

  it('emits a single counter with no labels', () => {
    const out = renderPrometheusExposition([{ name: 'foo_total', count: 5, attributes: {} }]);
    expect(out).toContain('# TYPE foo_total counter');
    expect(out).toContain('foo_total 5');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('emits one # HELP and one # TYPE per metric name (groups by name)', () => {
    const out = renderPrometheusExposition(
      [
        { name: 'http_requests_total', count: 3, attributes: { status: '200' } },
        { name: 'http_requests_total', count: 1, attributes: { status: '500' } },
      ],
      [],
      { counterHelp: { http_requests_total: 'HTTP request count' } },
    );
    expect((out.match(/# HELP http_requests_total /g) ?? []).length).toBe(1);
    expect((out.match(/# TYPE http_requests_total counter/g) ?? []).length).toBe(1);
    expect(out).toContain('http_requests_total{status="200"} 3');
    expect(out).toContain('http_requests_total{status="500"} 1');
  });

  it('escapes label values per spec (backslash, double-quote, newline)', () => {
    const out = renderPrometheusExposition([
      { name: 'tag_total', count: 1, attributes: { value: 'bad"v\nwith\\slash' } },
    ]);
    expect(out).toContain('tag_total{value="bad\\"v\\nwith\\\\slash"} 1');
  });

  it('drops entries whose metric name fails Prometheus naming validation', () => {
    const out = renderPrometheusExposition([
      { name: '123_invalid', count: 1, attributes: {} },
      { name: 'good_total', count: 2, attributes: {} },
    ]);
    expect(out).not.toContain('123_invalid');
    expect(out).toContain('good_total 2');
  });

  it('drops entries with non-finite counter values', () => {
    const out = renderPrometheusExposition([
      { name: 'good_total', count: 1, attributes: {} },
      { name: 'bad_total', count: NaN as unknown as number, attributes: {} },
      { name: 'inf_total', count: Number.POSITIVE_INFINITY, attributes: {} },
    ]);
    expect(out).toContain('good_total 1');
    expect(out).not.toContain('bad_total');
    expect(out).not.toContain('inf_total');
  });

  it('is deterministic: two runs of the same input produce byte-identical output', () => {
    const counters = [
      { name: 'b_total', count: 2, attributes: { region: 'us', tier: 'pro' } },
      { name: 'a_total', count: 1, attributes: { region: 'eu' } },
    ];
    const a = renderPrometheusExposition(counters);
    const b = renderPrometheusExposition(counters);
    expect(a).toBe(b);
    expect(a.indexOf('a_total')).toBeLessThan(a.indexOf('b_total'));
  });

  it('renders counter + gauge as distinct # TYPE blocks', () => {
    const out = renderPrometheusExposition(
      [{ name: 'requests_total', count: 7, attributes: {} }],
      [{ name: 'memory_bytes', value: 1024, help: 'Memory in bytes' }],
    );
    expect(out).toContain('# TYPE requests_total counter');
    expect(out).toContain('# TYPE memory_bytes gauge');
    expect(out).toContain('# HELP memory_bytes Memory in bytes');
    expect(out).toContain('memory_bytes 1024');
  });

  it('exposes the canonical Prometheus content type constant', () => {
    expect(PROMETHEUS_CONTENT_TYPE).toBe('text/plain; version=0.0.4; charset=utf-8');
  });
});

describe('renderJsonExposition (issue #397)', () => {
  it('returns a { counters, gauges } envelope', () => {
    const out = renderJsonExposition(
      [{ name: 'tool_calls_total', count: 4, attributes: { tool: 'echo' } }],
      [{ name: 'memory_bytes', value: 2048 }],
    );
    expect(out.counters).toEqual([{ name: 'tool_calls_total', count: 4, attributes: { tool: 'echo' } }]);
    expect(out.gauges[0]).toMatchObject({ name: 'memory_bytes', value: 2048 });
  });

  it('drops entries with invalid metric names or non-finite values', () => {
    const out = renderJsonExposition(
      [
        { name: 'good_total', count: 1, attributes: {} },
        { name: '0bad', count: 1, attributes: {} },
      ],
      [
        { name: 'good_bytes', value: 10 },
        { name: 'bad_bytes', value: NaN as unknown as number },
      ],
    );
    expect(out.counters.map((c) => c.name)).toEqual(['good_total']);
    expect(out.gauges.map((g) => g.name)).toEqual(['good_bytes']);
  });
});
