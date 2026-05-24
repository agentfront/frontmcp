import { ProcessStatsCollector } from '../process-stats.collector';

function makeHistogram(values: { mean: number; p99: number }) {
  return {
    mean: values.mean,
    percentile: (p: number) => (p === 99 ? values.p99 : 0),
    reset: jest.fn(),
    disable: jest.fn(),
  };
}

describe('ProcessStatsCollector (issue #397)', () => {
  it('emits CPU as a cumulative counter-shaped gauge in seconds, split by mode', () => {
    let cpuCall = 0;
    const collector = new ProcessStatsCollector({
      cpuUsage: () => {
        cpuCall += 1;
        return cpuCall === 1 ? { user: 0, system: 0 } : { user: 2_000_000, system: 500_000 };
      },
      memoryUsage: () => ({ rss: 1, heapTotal: 1, heapUsed: 1, external: 1, arrayBuffers: 0 }),
      uptime: () => 10,
      monitorEventLoopDelay: () => undefined,
      getActiveHandles: () => undefined,
      getActiveRequests: () => undefined,
      readFdCount: () => undefined,
    });

    const entries = collector.collect();
    const cpuUser = entries.find(
      (e) => e.name === 'frontmcp_process_cpu_seconds_total' && e.attributes?.mode === 'user',
    );
    const cpuSystem = entries.find(
      (e) => e.name === 'frontmcp_process_cpu_seconds_total' && e.attributes?.mode === 'system',
    );
    expect(cpuUser?.value).toBeCloseTo(2.0, 5);
    expect(cpuSystem?.value).toBeCloseTo(0.5, 5);
  });

  it('emits non-negative memory gauges and uptime', () => {
    const collector = new ProcessStatsCollector({
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({
        rss: 100_000,
        heapTotal: 80_000,
        heapUsed: 60_000,
        external: 20_000,
        arrayBuffers: 0,
      }),
      uptime: () => 42,
      monitorEventLoopDelay: () => undefined,
      getActiveHandles: () => undefined,
      getActiveRequests: () => undefined,
      readFdCount: () => undefined,
    });
    const entries = collector.collect();
    const byName = (n: string) => entries.find((e) => e.name === n)?.value ?? -1;
    expect(byName('frontmcp_process_resident_memory_bytes')).toBe(100_000);
    expect(byName('frontmcp_process_heap_bytes')).toBe(80_000);
    expect(byName('frontmcp_process_heap_used_bytes')).toBe(60_000);
    expect(byName('frontmcp_process_external_bytes')).toBe(20_000);
    expect(byName('frontmcp_process_uptime_seconds')).toBe(42);
  });

  it('emits event-loop lag (mean + p99) when enabled and resets the histogram per scrape', () => {
    const histogram = makeHistogram({ mean: 1_000_000, p99: 5_000_000 });
    const collector = new ProcessStatsCollector({
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      uptime: () => 0,
      monitorEventLoopDelay: () => histogram,
      getActiveHandles: () => undefined,
      getActiveRequests: () => undefined,
      readFdCount: () => undefined,
    });
    const entries = collector.collect();
    const mean = entries.find(
      (e) => e.name === 'frontmcp_nodejs_eventloop_lag_seconds' && e.attributes?.quantile === 'mean',
    );
    const p99 = entries.find(
      (e) => e.name === 'frontmcp_nodejs_eventloop_lag_seconds' && e.attributes?.quantile === 'p99',
    );
    expect(mean?.value).toBeCloseTo(0.001, 6);
    expect(p99?.value).toBeCloseTo(0.005, 6);
    expect(histogram.reset).toHaveBeenCalledTimes(1);
  });

  it('omits event-loop lag entirely when options.eventLoopLag === false', () => {
    const histogram = makeHistogram({ mean: 1_000_000, p99: 5_000_000 });
    const collector = new ProcessStatsCollector({
      options: { eventLoopLag: false },
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      uptime: () => 0,
      monitorEventLoopDelay: () => histogram,
      getActiveHandles: () => undefined,
      getActiveRequests: () => undefined,
      readFdCount: () => undefined,
    });
    const entries = collector.collect();
    expect(entries.find((e) => e.name === 'frontmcp_nodejs_eventloop_lag_seconds')).toBeUndefined();
  });

  it('emits active handles / active requests when available', () => {
    const collector = new ProcessStatsCollector({
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      uptime: () => 0,
      monitorEventLoopDelay: () => undefined,
      getActiveHandles: () => [1, 2, 3],
      getActiveRequests: () => [],
      readFdCount: () => undefined,
    });
    const entries = collector.collect();
    expect(entries.find((e) => e.name === 'frontmcp_nodejs_active_handles')?.value).toBe(3);
    expect(entries.find((e) => e.name === 'frontmcp_nodejs_active_requests')?.value).toBe(0);
  });

  it('silently skips fd count when probe returns undefined (non-Linux or readdir failure)', () => {
    const collector = new ProcessStatsCollector({
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      uptime: () => 0,
      monitorEventLoopDelay: () => undefined,
      getActiveHandles: () => undefined,
      getActiveRequests: () => undefined,
      readFdCount: () => undefined,
    });
    const entries = collector.collect();
    expect(entries.find((e) => e.name === 'frontmcp_nodejs_open_fds')).toBeUndefined();
  });

  it('emits fd count when the readFdCount probe returns a number', () => {
    const collector = new ProcessStatsCollector({
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      uptime: () => 0,
      monitorEventLoopDelay: () => undefined,
      getActiveHandles: () => undefined,
      getActiveRequests: () => undefined,
      readFdCount: () => 42,
    });
    const entries = collector.collect();
    expect(entries.find((e) => e.name === 'frontmcp_nodejs_open_fds')?.value).toBe(42);
  });

  describe('default probes (no injected overrides)', () => {
    it('runs end-to-end against real Node APIs and emits CPU + memory + uptime gauges', () => {
      const collector = new ProcessStatsCollector();
      const entries = collector.collect();
      const names = new Set(entries.map((e) => e.name));
      // CPU is always emitted (process.cpuUsage is everywhere).
      expect(names.has('frontmcp_process_cpu_seconds_total')).toBe(true);
      // Memory + uptime come from process.* and never fail.
      expect(names.has('frontmcp_process_resident_memory_bytes')).toBe(true);
      expect(names.has('frontmcp_process_heap_bytes')).toBe(true);
      expect(names.has('frontmcp_process_heap_used_bytes')).toBe(true);
      expect(names.has('frontmcp_process_external_bytes')).toBe(true);
      expect(names.has('frontmcp_process_uptime_seconds')).toBe(true);
      // Every emitted value is a finite non-negative number.
      for (const entry of entries) {
        expect(Number.isFinite(entry.value)).toBe(true);
        expect(entry.value).toBeGreaterThanOrEqual(0);
      }
      collector.close();
    });

    it('honors options.eventLoopLag === false with real defaults', () => {
      const collector = new ProcessStatsCollector({ options: { eventLoopLag: false } });
      const entries = collector.collect();
      expect(entries.find((e) => e.name === 'frontmcp_nodejs_eventloop_lag_seconds')).toBeUndefined();
      collector.close();
    });

    it('reads the fd count on Linux and skips it elsewhere via the default probe', () => {
      const collector = new ProcessStatsCollector();
      const entries = collector.collect();
      const fd = entries.find((e) => e.name === 'frontmcp_nodejs_open_fds');
      if (process.platform === 'linux') {
        expect(fd?.value).toBeGreaterThan(0);
      } else {
        expect(fd).toBeUndefined();
      }
      collector.close();
    });

    it('returns undefined from the default active-handles probe when _getActiveHandles is missing', () => {
      const original = (process as unknown as { _getActiveHandles?: unknown })._getActiveHandles;
      try {
        // Strip the undocumented probe so `defaultGetActiveHandles` hits the
        // feature-detection bail-out branch.
        (process as unknown as { _getActiveHandles?: unknown })._getActiveHandles = undefined;
        const collector = new ProcessStatsCollector();
        const entries = collector.collect();
        expect(entries.find((e) => e.name === 'frontmcp_nodejs_active_handles')).toBeUndefined();
        collector.close();
      } finally {
        (process as unknown as { _getActiveHandles?: unknown })._getActiveHandles = original;
      }
    });

    it('returns undefined from the default active-requests probe when _getActiveRequests is missing', () => {
      const original = (process as unknown as { _getActiveRequests?: unknown })._getActiveRequests;
      try {
        (process as unknown as { _getActiveRequests?: unknown })._getActiveRequests = undefined;
        const collector = new ProcessStatsCollector();
        const entries = collector.collect();
        expect(entries.find((e) => e.name === 'frontmcp_nodejs_active_requests')).toBeUndefined();
        collector.close();
      } finally {
        (process as unknown as { _getActiveRequests?: unknown })._getActiveRequests = original;
      }
    });

    it('returns undefined from the default active-handles probe when the API throws', () => {
      const original = (process as unknown as { _getActiveHandles?: unknown })._getActiveHandles;
      try {
        (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles = () => {
          throw new Error('boom');
        };
        const collector = new ProcessStatsCollector();
        const entries = collector.collect();
        expect(entries.find((e) => e.name === 'frontmcp_nodejs_active_handles')).toBeUndefined();
        collector.close();
      } finally {
        (process as unknown as { _getActiveHandles?: unknown })._getActiveHandles = original;
      }
    });

    it('returns undefined from the default active-requests probe when the API throws', () => {
      const original = (process as unknown as { _getActiveRequests?: unknown })._getActiveRequests;
      try {
        (process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests = () => {
          throw new Error('boom');
        };
        const collector = new ProcessStatsCollector();
        const entries = collector.collect();
        expect(entries.find((e) => e.name === 'frontmcp_nodejs_active_requests')).toBeUndefined();
        collector.close();
      } finally {
        (process as unknown as { _getActiveRequests?: unknown })._getActiveRequests = original;
      }
    });
  });

  it('drops non-finite event-loop lag samples (NaN/Infinity) so Prometheus never sees them', () => {
    const histogram = {
      mean: NaN,
      percentile: () => Infinity,
      reset: jest.fn(),
      disable: jest.fn(),
    };
    const collector = new ProcessStatsCollector({
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      uptime: () => 0,
      monitorEventLoopDelay: () => histogram,
      getActiveHandles: () => undefined,
      getActiveRequests: () => undefined,
      readFdCount: () => undefined,
    });
    const entries = collector.collect();
    expect(entries.filter((e) => e.name === 'frontmcp_nodejs_eventloop_lag_seconds')).toEqual([]);
    // Histogram is still reset so the next scrape sees a fresh window.
    expect(histogram.reset).toHaveBeenCalledTimes(1);
  });

  it('close() disables the event-loop lag histogram', () => {
    const histogram = makeHistogram({ mean: 0, p99: 0 });
    const collector = new ProcessStatsCollector({
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      uptime: () => 0,
      monitorEventLoopDelay: () => histogram,
      getActiveHandles: () => undefined,
      getActiveRequests: () => undefined,
      readFdCount: () => undefined,
    });
    collector.close();
    expect(histogram.disable).toHaveBeenCalledTimes(1);
  });
});
