/**
 * Memory Monitor
 *
 * Monitors memory usage across all worker slots and enforces limits.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'events';
import type { WorkerPoolConfig, ResourceUsage } from './config';
import type { WorkerSlot } from './worker-slot';

/**
 * Events emitted by MemoryMonitor
 */
export interface MemoryMonitorEvents {
  /** A worker exceeded memory limit */
  memoryExceeded: [slotId: string, usage: ResourceUsage, limit: number];
  /** Memory check failed for a worker */
  checkFailed: [slotId: string, error: Error];
  /** Memory check completed */
  checkComplete: [results: Map<string, ResourceUsage>];
}

/**
 * Memory monitor configuration
 */
export interface MemoryMonitorConfig {
  /** Memory limit per worker in bytes */
  memoryLimitPerWorker: number;
  /** Check interval in milliseconds */
  memoryCheckIntervalMs: number;
  /** Timeout for memory report requests */
  memoryReportTimeoutMs?: number;
}

/**
 * Memory monitor statistics
 */
export interface MemoryMonitorStats {
  /** Number of checks performed */
  checksPerformed: number;
  /** Number of memory exceeded events */
  memoryExceededCount: number;
  /** Number of check failures */
  checkFailureCount: number;
  /** Peak memory usage observed (bytes) */
  peakMemoryBytes: number;
  /** Average memory usage (bytes) */
  avgMemoryBytes: number;
  /** Total samples collected */
  totalSamples: number;
}

/**
 * Monitors worker memory usage and enforces limits
 */
export class MemoryMonitor extends EventEmitter {
  private readonly config: Required<MemoryMonitorConfig>;
  private readonly slots: Map<string, WorkerSlot>;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Statistics
  private _checksPerformed = 0;
  private _memoryExceededCount = 0;
  private _checkFailureCount = 0;
  private _peakMemoryBytes = 0;
  private _totalMemoryBytes = 0;
  private _totalSamples = 0;

  constructor(config: MemoryMonitorConfig, slots: Map<string, WorkerSlot>) {
    super();
    this.config = {
      memoryLimitPerWorker: config.memoryLimitPerWorker,
      memoryCheckIntervalMs: config.memoryCheckIntervalMs,
      memoryReportTimeoutMs: config.memoryReportTimeoutMs ?? 2000,
    };
    this.slots = slots;
  }

  /**
   * Start periodic memory monitoring
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.intervalId = setInterval(() => {
      this.checkAllSlots().catch((error) => {
        console.error('Memory monitor error:', error);
      });
    }, this.config.memoryCheckIntervalMs);
  }

  /**
   * Stop memory monitoring
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check if monitoring is active
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Perform a single check of all worker slots
   */
  async checkAllSlots(): Promise<Map<string, ResourceUsage>> {
    this._checksPerformed++;
    const results = new Map<string, ResourceUsage>();
    const promises: Promise<void>[] = [];

    for (const [slotId, slot] of this.slots) {
      // Only check idle or executing slots with a worker
      if ((slot.isIdle || slot.isExecuting) && slot.worker) {
        promises.push(this.checkSlot(slotId, slot, results));
      }
    }

    await Promise.allSettled(promises);
    this.emit('checkComplete', results);
    return results;
  }

  /**
   * Check a single slot's memory usage
   */
  private async checkSlot(slotId: string, slot: WorkerSlot, results: Map<string, ResourceUsage>): Promise<void> {
    try {
      const usage = await slot.requestMemoryReport(this.config.memoryReportTimeoutMs);
      results.set(slotId, usage);

      // Track statistics
      this._totalMemoryBytes += usage.rss;
      this._totalSamples++;
      if (usage.rss > this._peakMemoryBytes) {
        this._peakMemoryBytes = usage.rss;
      }

      // Check limit
      if (usage.rss > this.config.memoryLimitPerWorker) {
        this._memoryExceededCount++;
        this.emit('memoryExceeded', slotId, usage, this.config.memoryLimitPerWorker);

        // Mark slot for recycling
        slot.markForRecycle('memory-exceeded');
      }
    } catch (error) {
      this._checkFailureCount++;
      this.emit('checkFailed', slotId, error as Error);
    }
  }

  /**
   * Check a specific slot immediately (not part of periodic checks)
   */
  async checkSlotImmediate(slotId: string): Promise<ResourceUsage | null> {
    const slot = this.slots.get(slotId);
    if (!slot || !slot.worker) {
      return null;
    }

    try {
      const usage = await slot.requestMemoryReport(this.config.memoryReportTimeoutMs);

      // Track statistics
      this._totalMemoryBytes += usage.rss;
      this._totalSamples++;
      if (usage.rss > this._peakMemoryBytes) {
        this._peakMemoryBytes = usage.rss;
      }

      return usage;
    } catch {
      this._checkFailureCount++;
      return null;
    }
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryMonitorStats {
    return {
      checksPerformed: this._checksPerformed,
      memoryExceededCount: this._memoryExceededCount,
      checkFailureCount: this._checkFailureCount,
      peakMemoryBytes: this._peakMemoryBytes,
      avgMemoryBytes: this._totalSamples > 0 ? this._totalMemoryBytes / this._totalSamples : 0,
      totalSamples: this._totalSamples,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this._checksPerformed = 0;
    this._memoryExceededCount = 0;
    this._checkFailureCount = 0;
    this._peakMemoryBytes = 0;
    this._totalMemoryBytes = 0;
    this._totalSamples = 0;
  }

  /**
   * Get current memory usage summary
   */
  getCurrentUsageSummary(): {
    totalRss: number;
    avgRss: number;
    maxRss: number;
    slotCount: number;
  } {
    let totalRss = 0;
    let maxRss = 0;
    let slotCount = 0;

    for (const slot of this.slots.values()) {
      if (slot.memoryUsage) {
        totalRss += slot.memoryUsage.rss;
        if (slot.memoryUsage.rss > maxRss) {
          maxRss = slot.memoryUsage.rss;
        }
        slotCount++;
      }
    }

    return {
      totalRss,
      avgRss: slotCount > 0 ? totalRss / slotCount : 0,
      maxRss,
      slotCount,
    };
  }
}
