/**
 * @file perf-fixtures.ts
 * @description Performance testing fixtures implementation
 */

import type {
  PerfFixtures,
  PerfSnapshot,
  PerfThresholds,
  LeakDetectionOptions,
  LeakDetectionResult,
  PerfMeasurement,
  PerfIssue,
  ParallelLeakDetectionOptions,
  ParallelLeakDetectionResult,
  ParallelTestClient,
} from './types';
import { MetricsCollector, formatBytes, formatDuration } from './metrics-collector';
import { LeakDetector } from './leak-detector';

// ═══════════════════════════════════════════════════════════════════
// PERF FIXTURE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Creates a PerfFixtures instance for a test.
 */
export function createPerfFixtures(testName: string, project: string): PerfFixturesImpl {
  return new PerfFixturesImpl(testName, project);
}

/**
 * Implementation of PerfFixtures interface.
 */
export class PerfFixturesImpl implements PerfFixtures {
  private collector: MetricsCollector;
  private leakDetector: LeakDetector;
  private baselineSnapshot: PerfSnapshot | null = null;
  private startTime: number = 0;
  private issues: PerfIssue[] = [];
  private leakResults: LeakDetectionResult[] = [];

  constructor(
    private readonly testName: string,
    private readonly project: string,
  ) {
    this.collector = new MetricsCollector();
    this.leakDetector = new LeakDetector();
  }

  /**
   * Capture baseline snapshot with GC.
   */
  async baseline(): Promise<PerfSnapshot> {
    this.startTime = Date.now();
    this.baselineSnapshot = await this.collector.captureBaseline();
    return this.baselineSnapshot;
  }

  /**
   * Capture a measurement snapshot.
   */
  measure(label?: string): PerfSnapshot {
    return this.collector.captureSnapshot(label);
  }

  /**
   * Run leak detection on an operation.
   */
  async checkLeak(operation: () => Promise<void>, options?: LeakDetectionOptions): Promise<LeakDetectionResult> {
    const result = await this.leakDetector.detectLeak(operation, options);

    // Store the leak detection result for reporting
    this.leakResults.push(result);

    if (result.hasLeak) {
      this.issues.push({
        type: 'memory-leak',
        severity: 'error',
        message: result.message,
        metric: 'heapUsed',
        actual: result.totalGrowth,
        expected: options?.threshold ?? 1024 * 1024,
      });
    }

    return result;
  }

  /**
   * Run parallel leak detection using multiple clients.
   * Each worker gets its own client for true parallel HTTP requests.
   *
   * @param operationFactory - Factory that receives a client and worker index, returns an operation function
   * @param options - Detection options including worker count and client factory
   * @returns Combined leak detection result with per-worker statistics
   *
   * @example
   * ```typescript
   * const result = await perf.checkLeakParallel(
   *   (client, workerId) => async () => {
   *     await client.tools.call('loadSkills', { skillIds: ['review-pr'] });
   *   },
   *   {
   *     iterations: 1000,
   *     workers: 5,
   *     clientFactory: () => server.createClient(),
   *   }
   * );
   * // 5 workers × ~80 req/s = ~400 req/s total
   * expect(result.totalRequestsPerSecond).toBeGreaterThan(300);
   * ```
   */
  async checkLeakParallel(
    operationFactory: (client: ParallelTestClient, workerId: number) => () => Promise<void>,
    options: ParallelLeakDetectionOptions & { clientFactory: () => Promise<ParallelTestClient> },
  ): Promise<ParallelLeakDetectionResult> {
    const result = await this.leakDetector.detectLeakParallel(operationFactory, options);

    // Store the leak detection result for reporting
    this.leakResults.push(result);

    if (result.hasLeak) {
      this.issues.push({
        type: 'memory-leak',
        severity: 'error',
        message: result.message,
        metric: 'heapUsed',
        actual: result.totalGrowth,
        expected: options?.threshold ?? 1024 * 1024,
      });
    }

    return result;
  }

  /**
   * Assert that metrics are within thresholds.
   */
  assertThresholds(thresholds: PerfThresholds): void {
    const finalSnapshot = this.collector.captureSnapshot('final');
    const baseline = this.collector.getBaseline();

    if (!baseline) {
      throw new Error('Cannot assert thresholds without baseline. Call baseline() first.');
    }

    const duration = Date.now() - this.startTime;
    const memoryDelta = this.collector.calculateMemoryDelta(finalSnapshot.memory);

    // Check heap delta
    if (thresholds.maxHeapDelta !== undefined && memoryDelta) {
      if (memoryDelta.heapUsed > thresholds.maxHeapDelta) {
        const issue: PerfIssue = {
          type: 'threshold-exceeded',
          severity: 'error',
          message: `Heap delta ${formatBytes(memoryDelta.heapUsed)} exceeds threshold ${formatBytes(thresholds.maxHeapDelta)}`,
          metric: 'heapUsed',
          actual: memoryDelta.heapUsed,
          expected: thresholds.maxHeapDelta,
        };
        this.issues.push(issue);
        throw new Error(issue.message);
      }
    }

    // Check duration
    if (thresholds.maxDurationMs !== undefined) {
      if (duration > thresholds.maxDurationMs) {
        const issue: PerfIssue = {
          type: 'threshold-exceeded',
          severity: 'error',
          message: `Duration ${formatDuration(duration)} exceeds threshold ${formatDuration(thresholds.maxDurationMs)}`,
          metric: 'durationMs',
          actual: duration,
          expected: thresholds.maxDurationMs,
        };
        this.issues.push(issue);
        throw new Error(issue.message);
      }
    }

    // Check CPU time
    if (thresholds.maxCpuTime !== undefined) {
      const cpuUsage = this.collector.getCpuUsage();
      if (cpuUsage.total > thresholds.maxCpuTime) {
        const issue: PerfIssue = {
          type: 'threshold-exceeded',
          severity: 'error',
          message: `CPU time ${cpuUsage.total}µs exceeds threshold ${thresholds.maxCpuTime}µs`,
          metric: 'cpuTime',
          actual: cpuUsage.total,
          expected: thresholds.maxCpuTime,
        };
        this.issues.push(issue);
        throw new Error(issue.message);
      }
    }

    // Check RSS delta
    if (thresholds.maxRssDelta !== undefined && memoryDelta) {
      if (memoryDelta.rss > thresholds.maxRssDelta) {
        const issue: PerfIssue = {
          type: 'threshold-exceeded',
          severity: 'error',
          message: `RSS delta ${formatBytes(memoryDelta.rss)} exceeds threshold ${formatBytes(thresholds.maxRssDelta)}`,
          metric: 'rss',
          actual: memoryDelta.rss,
          expected: thresholds.maxRssDelta,
        };
        this.issues.push(issue);
        throw new Error(issue.message);
      }
    }
  }

  /**
   * Get all measurements so far.
   */
  getMeasurements(): PerfSnapshot[] {
    return this.collector.getMeasurements();
  }

  /**
   * Get the current test name.
   */
  getTestName(): string {
    return this.testName;
  }

  /**
   * Get the project name.
   */
  getProject(): string {
    return this.project;
  }

  /**
   * Get all detected issues.
   */
  getIssues(): PerfIssue[] {
    return [...this.issues];
  }

  /**
   * Build a complete PerfMeasurement for this test.
   */
  buildMeasurement(): PerfMeasurement {
    const endTime = Date.now();
    const finalSnapshot = this.collector.captureSnapshot('final');
    const baseline = this.collector.getBaseline();
    const memoryDelta = baseline ? this.collector.calculateMemoryDelta(finalSnapshot.memory) : undefined;

    return {
      name: this.testName,
      project: this.project,
      baseline: baseline ?? finalSnapshot,
      measurements: this.collector.getMeasurements(),
      final: finalSnapshot,
      timing: {
        startTime: this.startTime || endTime,
        endTime,
        durationMs: endTime - (this.startTime || endTime),
      },
      memoryDelta: memoryDelta ?? undefined,
      issues: this.getIssues(),
      leakDetectionResults: this.leakResults.length > 0 ? this.leakResults : undefined,
    };
  }

  /**
   * Reset the fixture state.
   */
  reset(): void {
    this.collector.reset();
    this.baselineSnapshot = null;
    this.startTime = 0;
    this.issues = [];
    this.leakResults = [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL STATE FOR COLLECTING MEASUREMENTS
// ═══════════════════════════════════════════════════════════════════

// Use globalThis to share measurements between test modules and reporter
// This is necessary because Jest may load modules in different contexts
const MEASUREMENTS_KEY = '__FRONTMCP_PERF_MEASUREMENTS__';

function getGlobalMeasurementsArray(): PerfMeasurement[] {
  if (!(globalThis as Record<string, unknown>)[MEASUREMENTS_KEY]) {
    (globalThis as Record<string, unknown>)[MEASUREMENTS_KEY] = [];
  }
  return (globalThis as Record<string, unknown>)[MEASUREMENTS_KEY] as PerfMeasurement[];
}

/**
 * Add a measurement to the global collection.
 */
export function addGlobalMeasurement(measurement: PerfMeasurement): void {
  getGlobalMeasurementsArray().push(measurement);
}

/**
 * Get all global measurements.
 */
export function getGlobalMeasurements(): PerfMeasurement[] {
  return [...getGlobalMeasurementsArray()];
}

/**
 * Clear all global measurements.
 */
export function clearGlobalMeasurements(): void {
  const arr = getGlobalMeasurementsArray();
  arr.length = 0;
}

/**
 * Get measurements for a specific project.
 */
export function getMeasurementsForProject(project: string): PerfMeasurement[] {
  return getGlobalMeasurementsArray().filter((m) => m.project === project);
}
