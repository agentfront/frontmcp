/**
 * @file metrics-collector.ts
 * @description Memory and CPU metrics collection utilities
 */

import type { MemoryMetrics, CpuMetrics, PerfSnapshot } from './types';

// ═══════════════════════════════════════════════════════════════════
// GARBAGE COLLECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if manual GC is available (requires --expose-gc flag)
 */
export function isGcAvailable(): boolean {
  return typeof global.gc === 'function';
}

/**
 * Force garbage collection if available.
 * Requires Node.js to be started with --expose-gc flag.
 */
export function forceGc(): void {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

/**
 * Force multiple GC cycles to ensure thorough cleanup.
 * V8 may need multiple passes to collect all garbage.
 */
export async function forceFullGc(cycles = 3, delayMs = 10): Promise<void> {
  if (!isGcAvailable()) {
    return;
  }

  for (let i = 0; i < cycles; i++) {
    forceGc();
    if (i < cycles - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// METRICS COLLECTOR CLASS
// ═══════════════════════════════════════════════════════════════════

/**
 * Collects memory and CPU metrics for performance testing
 */
export class MetricsCollector {
  private cpuStartUsage: NodeJS.CpuUsage | null = null;
  private baseline: PerfSnapshot | null = null;
  private measurements: PerfSnapshot[] = [];

  /**
   * Capture the baseline snapshot.
   * Forces GC to get a clean memory state.
   */
  async captureBaseline(forceGcCycles = 3): Promise<PerfSnapshot> {
    // Force GC to get clean baseline
    await forceFullGc(forceGcCycles);

    // Start CPU tracking from this point
    this.cpuStartUsage = process.cpuUsage();

    // Capture memory snapshot
    const snapshot = this.captureSnapshot('baseline');
    this.baseline = snapshot;

    return snapshot;
  }

  /**
   * Capture a snapshot of current memory and CPU state.
   */
  captureSnapshot(label?: string): PerfSnapshot {
    const memUsage = process.memoryUsage();
    const cpuUsage = this.cpuStartUsage ? process.cpuUsage(this.cpuStartUsage) : process.cpuUsage();

    const snapshot: PerfSnapshot = {
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
        arrayBuffers: memUsage.arrayBuffers,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        total: cpuUsage.user + cpuUsage.system,
      },
      timestamp: Date.now(),
      label,
    };

    if (label !== 'baseline') {
      this.measurements.push(snapshot);
    }

    return snapshot;
  }

  /**
   * Start CPU tracking from this point.
   */
  startCpuTracking(): void {
    this.cpuStartUsage = process.cpuUsage();
  }

  /**
   * Get CPU usage since tracking started.
   */
  getCpuUsage(): CpuMetrics {
    const usage = this.cpuStartUsage ? process.cpuUsage(this.cpuStartUsage) : process.cpuUsage();

    return {
      user: usage.user,
      system: usage.system,
      total: usage.user + usage.system,
    };
  }

  /**
   * Get current memory metrics.
   */
  getMemoryMetrics(): MemoryMetrics {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers,
    };
  }

  /**
   * Get the baseline snapshot if captured.
   */
  getBaseline(): PerfSnapshot | null {
    return this.baseline;
  }

  /**
   * Get all measurement snapshots.
   */
  getMeasurements(): PerfSnapshot[] {
    return [...this.measurements];
  }

  /**
   * Calculate memory delta from baseline.
   */
  calculateMemoryDelta(current: MemoryMetrics): {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  } | null {
    if (!this.baseline) {
      return null;
    }

    return {
      heapUsed: current.heapUsed - this.baseline.memory.heapUsed,
      heapTotal: current.heapTotal - this.baseline.memory.heapTotal,
      rss: current.rss - this.baseline.memory.rss,
    };
  }

  /**
   * Reset the collector state.
   */
  reset(): void {
    this.cpuStartUsage = null;
    this.baseline = null;
    this.measurements = [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Format bytes to human readable string.
 */
export function formatBytes(bytes: number): string {
  const absBytes = Math.abs(bytes);
  const sign = bytes < 0 ? '-' : '';

  if (absBytes < 1024) {
    return `${sign}${absBytes} B`;
  }
  if (absBytes < 1024 * 1024) {
    return `${sign}${(absBytes / 1024).toFixed(2)} KB`;
  }
  if (absBytes < 1024 * 1024 * 1024) {
    return `${sign}${(absBytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${sign}${(absBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format microseconds to human readable string.
 */
export function formatMicroseconds(us: number): string {
  if (us < 1000) {
    return `${us.toFixed(2)} µs`;
  }
  if (us < 1000000) {
    return `${(us / 1000).toFixed(2)} ms`;
  }
  return `${(us / 1000000).toFixed(2)} s`;
}

/**
 * Format milliseconds to human readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)} ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${(ms / 60000).toFixed(2)} min`;
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a global singleton collector for use across tests.
 */
let globalCollector: MetricsCollector | null = null;

export function getGlobalCollector(): MetricsCollector {
  if (!globalCollector) {
    globalCollector = new MetricsCollector();
  }
  return globalCollector;
}

export function resetGlobalCollector(): void {
  if (globalCollector) {
    globalCollector.reset();
  }
  globalCollector = null;
}
