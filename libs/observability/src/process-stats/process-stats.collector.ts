/**
 * Process-stats collector (issue #397).
 *
 * Emits per-scrape Node.js process metrics in `GaugeSnapshotEntry` shape so
 * the Prometheus serializer can pass them straight through. Pure read of
 * `process.*` and `perf_hooks.monitorEventLoopDelay()` — no I/O beyond the
 * single Linux-only `/proc/self/fd` directory probe (wrapped in try/catch
 * so non-Linux platforms silently skip that gauge).
 *
 * Design choices:
 *   - CPU is emitted as a monotonic counter-shaped gauge built from
 *     `process.cpuUsage()` deltas — operators graph `rate()` of this.
 *   - Event-loop lag uses `perf_hooks.monitorEventLoopDelay({ resolution: 10 })`
 *     started at construction; `collect()` reads mean + p99 and calls
 *     `reset()` so each scrape sees a fresh window.
 *   - `process._getActiveHandles()` / `_getActiveRequests()` are
 *     undocumented but stable since Node 14; guarded behind feature
 *     detection so they no-op on edge runtimes.
 *   - All probes are individually toggleable via `MetricsProcessOptions`.
 */

import { readdirSync } from '@frontmcp/utils';

import type { GaugeSnapshotEntry } from '../prometheus/render';

interface MetricsProcessOptions {
  eventLoopLag?: boolean;
  fdCount?: boolean;
  activeHandles?: boolean;
}

interface ELDHistogram {
  mean: number;
  percentile(p: number): number;
  reset(): void;
  disable?(): void;
}

/**
 * Optional dependency injection points used by tests; production callers
 * never pass these.
 */
interface ProcessStatsCollectorOptions {
  options?: MetricsProcessOptions;
  cpuUsage?: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  memoryUsage?: () => NodeJS.MemoryUsage;
  uptime?: () => number;
  monitorEventLoopDelay?: () => ELDHistogram | undefined;
  getActiveHandles?: () => unknown[] | undefined;
  getActiveRequests?: () => unknown[] | undefined;
  readFdCount?: () => number | undefined;
}

const NS_PER_SECOND = 1e9;
const MICROS_PER_SECOND = 1e6;

function defaultMonitorEventLoopDelay(): ELDHistogram | undefined {
  try {
    const { monitorEventLoopDelay } = require('node:perf_hooks') as typeof import('node:perf_hooks');
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    return histogram as unknown as ELDHistogram;
  } catch {
    return undefined;
  }
}

function defaultGetActiveHandles(): unknown[] | undefined {
  const proc = process as unknown as { _getActiveHandles?: () => unknown[] };
  if (typeof proc._getActiveHandles !== 'function') return undefined;
  try {
    return proc._getActiveHandles();
  } catch {
    return undefined;
  }
}

function defaultGetActiveRequests(): unknown[] | undefined {
  const proc = process as unknown as { _getActiveRequests?: () => unknown[] };
  if (typeof proc._getActiveRequests !== 'function') return undefined;
  try {
    return proc._getActiveRequests();
  } catch {
    return undefined;
  }
}

function defaultReadFdCount(): number | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    return readdirSync('/proc/self/fd').length;
  } catch {
    return undefined;
  }
}

export class ProcessStatsCollector {
  private readonly options: MetricsProcessOptions;
  private readonly cpuUsage: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  private readonly memoryUsage: () => NodeJS.MemoryUsage;
  private readonly uptime: () => number;
  private readonly histogram?: ELDHistogram;
  private readonly getActiveHandles?: () => unknown[] | undefined;
  private readonly getActiveRequests?: () => unknown[] | undefined;
  private readonly readFdCount: () => number | undefined;
  private cpuStart: NodeJS.CpuUsage;

  constructor(init: ProcessStatsCollectorOptions = {}) {
    this.options = init.options ?? {};
    this.cpuUsage = init.cpuUsage ?? ((prev?: NodeJS.CpuUsage) => process.cpuUsage(prev));
    this.memoryUsage = init.memoryUsage ?? (() => process.memoryUsage());
    this.uptime = init.uptime ?? (() => process.uptime());
    this.getActiveHandles = init.getActiveHandles ?? defaultGetActiveHandles;
    this.getActiveRequests = init.getActiveRequests ?? defaultGetActiveRequests;
    this.readFdCount = init.readFdCount ?? defaultReadFdCount;
    this.cpuStart = this.cpuUsage();
    if (this.options.eventLoopLag !== false) {
      this.histogram = init.monitorEventLoopDelay ? init.monitorEventLoopDelay() : defaultMonitorEventLoopDelay();
    }
  }

  collect(): GaugeSnapshotEntry[] {
    const entries: GaugeSnapshotEntry[] = [];

    const cpu = this.cpuUsage(this.cpuStart);
    entries.push({
      name: 'frontmcp_process_cpu_seconds_total',
      value: cpu.user / MICROS_PER_SECOND,
      attributes: { mode: 'user' },
      help: 'CPU time consumed since collector start, by mode (seconds)',
    });
    entries.push({
      name: 'frontmcp_process_cpu_seconds_total',
      value: cpu.system / MICROS_PER_SECOND,
      attributes: { mode: 'system' },
    });

    const mem = this.memoryUsage();
    entries.push({
      name: 'frontmcp_process_resident_memory_bytes',
      value: mem.rss,
      help: 'Resident memory size in bytes',
    });
    entries.push({
      name: 'frontmcp_process_heap_bytes',
      value: mem.heapTotal,
      help: 'Total V8 heap size in bytes',
    });
    entries.push({
      name: 'frontmcp_process_heap_used_bytes',
      value: mem.heapUsed,
      help: 'Used V8 heap size in bytes',
    });
    entries.push({
      name: 'frontmcp_process_external_bytes',
      value: mem.external,
      help: 'Memory used by C++ objects bound to JS in bytes',
    });

    entries.push({
      name: 'frontmcp_process_uptime_seconds',
      value: this.uptime(),
      help: 'Time since process start in seconds',
    });

    if (this.options.eventLoopLag !== false && this.histogram) {
      const meanSeconds = this.histogram.mean / NS_PER_SECOND;
      const p99Seconds = this.histogram.percentile(99) / NS_PER_SECOND;
      if (Number.isFinite(meanSeconds)) {
        entries.push({
          name: 'frontmcp_nodejs_eventloop_lag_seconds',
          value: meanSeconds,
          attributes: { quantile: 'mean' },
          help: 'Event-loop lag in seconds, sampled at 10ms resolution since the last scrape',
        });
      }
      if (Number.isFinite(p99Seconds)) {
        entries.push({
          name: 'frontmcp_nodejs_eventloop_lag_seconds',
          value: p99Seconds,
          attributes: { quantile: 'p99' },
        });
      }
      this.histogram.reset();
    }

    if (this.options.activeHandles !== false) {
      const handles = this.getActiveHandles?.();
      if (handles !== undefined) {
        entries.push({
          name: 'frontmcp_nodejs_active_handles',
          value: handles.length,
          help: 'Currently active libuv handles (sockets, timers, etc.)',
        });
      }
      const requests = this.getActiveRequests?.();
      if (requests !== undefined) {
        entries.push({
          name: 'frontmcp_nodejs_active_requests',
          value: requests.length,
          help: 'Currently active libuv requests (file I/O, DNS, etc.)',
        });
      }
    }

    if (this.options.fdCount !== false) {
      const fdCount = this.readFdCount();
      if (typeof fdCount === 'number') {
        entries.push({
          name: 'frontmcp_nodejs_open_fds',
          value: fdCount,
          help: 'Number of open file descriptors (Linux only)',
        });
      }
    }

    return entries;
  }

  /**
   * Release the perf_hooks histogram listener. Call when the collector is
   * no longer used (e.g., when reconfiguring the server).
   */
  close(): void {
    this.histogram?.disable?.();
  }
}
