/**
 * @file leak-detector.ts
 * @description Memory leak detection using iterative measurement and linear regression
 */

import type {
  LeakDetectionOptions,
  LeakDetectionResult,
  IntervalMeasurement,
  MemoryGraphPoint,
  ParallelLeakDetectionOptions,
  ParallelLeakDetectionResult,
  WorkerStats,
  ParallelTestClient,
} from './types';
import { forceFullGc, isGcAvailable, formatBytes } from './metrics-collector';

// ═══════════════════════════════════════════════════════════════════
// DEFAULT OPTIONS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_OPTIONS: Required<LeakDetectionOptions> & { intervalSize: number } = {
  iterations: 20,
  threshold: 1024 * 1024, // 1 MB
  warmupIterations: 3,
  forceGc: true,
  delayMs: 10,
  intervalSize: 10, // Default interval size for measurements
};

const DEFAULT_PARALLEL_OPTIONS = {
  ...DEFAULT_OPTIONS,
  workers: 5, // Default number of parallel workers
};

// ═══════════════════════════════════════════════════════════════════
// LINEAR REGRESSION
// ═══════════════════════════════════════════════════════════════════

interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

/**
 * Perform simple linear regression on a series of values.
 * X values are indices (0, 1, 2, ...), Y values are the samples.
 */
function linearRegression(samples: number[]): LinearRegressionResult {
  const n = samples.length;
  if (n < 2) {
    return { slope: 0, intercept: samples[0] ?? 0, rSquared: 0 };
  }

  // Calculate means
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += samples[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Calculate slope and intercept
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    const dy = samples[i] - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;

  // Calculate R² (coefficient of determination)
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * i;
    const residual = samples[i] - predicted;
    ssRes += residual * residual;
    ssTot += (samples[i] - meanY) * (samples[i] - meanY);
  }
  const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, rSquared };
}

// ═══════════════════════════════════════════════════════════════════
// LEAK DETECTOR CLASS
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects memory leaks by running an operation multiple times
 * and analyzing heap growth using linear regression.
 */
export class LeakDetector {
  /**
   * Run leak detection on an async operation.
   *
   * @param operation - The operation to test for leaks
   * @param options - Detection options
   * @returns Leak detection result
   *
   * @example
   * ```typescript
   * const detector = new LeakDetector();
   * const result = await detector.detectLeak(
   *   async () => mcp.tools.call('my-tool', {}),
   *   { iterations: 50, threshold: 5 * 1024 * 1024 }
   * );
   * expect(result.hasLeak).toBe(false);
   * ```
   */
  async detectLeak(operation: () => Promise<void>, options?: LeakDetectionOptions): Promise<LeakDetectionResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { iterations, threshold, warmupIterations, forceGc, delayMs, intervalSize } = opts;

    // Warn if GC is not available
    if (forceGc && !isGcAvailable()) {
      console.warn('[LeakDetector] Manual GC not available. Run Node.js with --expose-gc for accurate results.');
    }

    // Run warmup iterations (not counted)
    for (let i = 0; i < warmupIterations; i++) {
      await operation();
    }

    // Force GC to establish clean baseline
    if (forceGc) {
      await forceFullGc();
    }

    const samples: number[] = [];
    const startTime = Date.now();

    // Collect heap samples after each iteration
    for (let i = 0; i < iterations; i++) {
      await operation();

      if (forceGc) {
        await forceFullGc(2, 5);
      }

      // Record heap usage
      samples.push(process.memoryUsage().heapUsed);

      // Small delay between iterations
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    const durationMs = Date.now() - startTime;

    // Analyze using linear regression
    return this.analyzeLeakPattern(samples, threshold, intervalSize, durationMs);
  }

  /**
   * Run leak detection on a sync operation.
   */
  detectLeakSync(operation: () => void, options?: LeakDetectionOptions): LeakDetectionResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { iterations, threshold, warmupIterations, forceGc, intervalSize } = opts;

    // Run warmup iterations
    for (let i = 0; i < warmupIterations; i++) {
      operation();
    }

    // Force GC to establish clean baseline
    if (forceGc && isGcAvailable()) {
      global.gc!();
      global.gc!();
      global.gc!();
    }

    const samples: number[] = [];

    // Collect heap samples after each iteration
    for (let i = 0; i < iterations; i++) {
      operation();

      if (forceGc && isGcAvailable()) {
        global.gc!();
        global.gc!();
      }

      samples.push(process.memoryUsage().heapUsed);
    }

    return this.analyzeLeakPattern(samples, threshold, intervalSize);
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
   * const detector = new LeakDetector();
   * const result = await detector.detectLeakParallel(
   *   (client, workerId) => async () => client.tools.call('my-tool', {}),
   *   {
   *     iterations: 1000,
   *     workers: 5,
   *     clientFactory: () => server.createClient(),
   *   }
   * );
   * // 5 workers × ~80 req/s = ~400 req/s total
   * console.log(result.totalRequestsPerSecond);
   * ```
   */
  async detectLeakParallel(
    operationFactory: (client: ParallelTestClient, workerId: number) => () => Promise<void>,
    options: ParallelLeakDetectionOptions & { clientFactory: () => Promise<ParallelTestClient> },
  ): Promise<ParallelLeakDetectionResult> {
    const opts = { ...DEFAULT_PARALLEL_OPTIONS, ...options };
    const { iterations, threshold, warmupIterations, forceGc, workers, intervalSize, clientFactory } = opts;

    // Warn if GC is not available
    if (forceGc && !isGcAvailable()) {
      console.warn('[LeakDetector] Manual GC not available. Run Node.js with --expose-gc for accurate results.');
    }

    // Create clients sequentially to avoid overwhelming the server
    console.log(`[LeakDetector] Creating ${workers} clients sequentially...`);
    const clients: ParallelTestClient[] = [];
    for (let i = 0; i < workers; i++) {
      console.log(`[LeakDetector] Creating client ${i + 1}/${workers}...`);
      const client = await clientFactory();
      clients.push(client);
    }
    console.log(`[LeakDetector] All ${workers} clients connected`);

    // Create operation functions for each worker using their dedicated client
    const operations = clients.map((client, workerId) => operationFactory(client, workerId));

    // Run warmup iterations for all workers in parallel
    console.log(`[LeakDetector] Running ${warmupIterations} warmup iterations per worker...`);
    await Promise.all(
      operations.map(async (operation) => {
        for (let i = 0; i < warmupIterations; i++) {
          await operation();
        }
      }),
    );

    // Force GC to establish clean baseline
    if (forceGc) {
      await forceFullGc();
    }

    console.log(`[LeakDetector] Starting parallel stress test: ${workers} workers × ${iterations} iterations`);
    const globalStartTime = Date.now();

    // Run workers in parallel, each collecting their own samples
    const workerResults = await Promise.all(
      operations.map(async (operation, workerId) => {
        const samples: number[] = [];
        const workerStartTime = Date.now();

        for (let i = 0; i < iterations; i++) {
          await operation();

          // Only run GC occasionally in parallel mode to avoid contention
          // GC every intervalSize iterations instead of every iteration
          if (forceGc && i > 0 && i % intervalSize === 0) {
            await forceFullGc(1, 2);
          }

          samples.push(process.memoryUsage().heapUsed);
        }

        const workerDurationMs = Date.now() - workerStartTime;
        const requestsPerSecond = (iterations / workerDurationMs) * 1000;

        return {
          workerId,
          samples,
          durationMs: workerDurationMs,
          requestsPerSecond,
          iterationsCompleted: iterations,
        } satisfies WorkerStats;
      }),
    );

    const globalDurationMs = Date.now() - globalStartTime;

    // Disconnect all clients
    await Promise.all(
      clients.map(async (client) => {
        if (client.disconnect) {
          await client.disconnect();
        }
      }),
    );

    // Aggregate all samples from all workers
    const allSamples = workerResults.flatMap((w) => w.samples);

    // Calculate total throughput
    const totalIterations = workers * iterations;
    const totalRequestsPerSecond = (totalIterations / globalDurationMs) * 1000;

    // Analyze the combined memory pattern
    const baseResult = this.analyzeLeakPattern(allSamples, threshold, intervalSize, globalDurationMs);

    // Build enhanced result message
    const workerSummary = workerResults
      .map((w) => `  Worker ${w.workerId}: ${w.requestsPerSecond.toFixed(1)} req/s`)
      .join('\n');

    const parallelMessage =
      `${baseResult.message}\n\n` +
      `Parallel execution summary:\n` +
      `  Workers: ${workers}\n` +
      `  Total iterations: ${totalIterations}\n` +
      `  Combined throughput: ${totalRequestsPerSecond.toFixed(1)} req/s\n` +
      `  Duration: ${(globalDurationMs / 1000).toFixed(2)}s\n` +
      `Per-worker throughput:\n${workerSummary}`;

    return {
      ...baseResult,
      message: parallelMessage,
      workersUsed: workers,
      totalRequestsPerSecond,
      perWorkerStats: workerResults,
      totalIterations,
      durationMs: globalDurationMs,
      requestsPerSecond: totalRequestsPerSecond,
    };
  }

  /**
   * Analyze heap samples for leak patterns using linear regression.
   */
  private analyzeLeakPattern(
    samples: number[],
    threshold: number,
    intervalSize = 10,
    durationMs?: number,
  ): LeakDetectionResult {
    if (samples.length < 2) {
      return {
        hasLeak: false,
        leakSizePerIteration: 0,
        totalGrowth: 0,
        growthRate: 0,
        rSquared: 0,
        samples,
        message: 'Insufficient samples for leak detection',
        intervals: [],
        graphData: [],
        durationMs,
        requestsPerSecond: 0,
      };
    }

    const { slope, rSquared } = linearRegression(samples);
    const totalGrowth = samples[samples.length - 1] - samples[0];
    const growthRate = slope;

    // Calculate requests per second
    const requestsPerSecond = durationMs && durationMs > 0 ? (samples.length / durationMs) * 1000 : 0;

    // Generate interval measurements
    const intervals = this.generateIntervals(samples, intervalSize);

    // Generate graph data points
    const graphData = this.generateGraphData(samples);

    // A leak is detected if:
    // 1. Total growth exceeds threshold AND
    // 2. Growth is consistently linear (R² > 0.7) OR
    // 3. Growth rate per iteration exceeds threshold / iterations
    const isSignificantGrowth = totalGrowth > threshold;
    const isLinearGrowth = rSquared > 0.7;
    const isHighGrowthRate = growthRate > threshold / samples.length;

    const hasLeak = isSignificantGrowth && (isLinearGrowth || isHighGrowthRate);

    // Build interval summary for message
    const intervalSummary = intervals
      .map((i) => `  ${i.startIteration}-${i.endIteration}: ${i.deltaFormatted}`)
      .join('\n');

    // Performance stats
    const perfStats = durationMs
      ? `\nPerformance: ${samples.length} iterations in ${(durationMs / 1000).toFixed(2)}s (${requestsPerSecond.toFixed(1)} req/s)`
      : '';

    let message: string;
    if (hasLeak) {
      message =
        `Memory leak detected: ${formatBytes(totalGrowth)} total growth, ` +
        `${formatBytes(growthRate)}/iteration, R²=${rSquared.toFixed(3)}\n` +
        `Interval breakdown:\n${intervalSummary}${perfStats}`;
    } else if (isSignificantGrowth) {
      message =
        `Memory growth detected (${formatBytes(totalGrowth)}) but not linear ` +
        `(R²=${rSquared.toFixed(3)}), may be normal allocation\n` +
        `Interval breakdown:\n${intervalSummary}${perfStats}`;
    } else {
      message =
        `No leak detected: ${formatBytes(totalGrowth)} total, ` +
        `${formatBytes(growthRate)}/iteration\n` +
        `Interval breakdown:\n${intervalSummary}${perfStats}`;
    }

    return {
      hasLeak,
      leakSizePerIteration: hasLeak ? growthRate : 0,
      totalGrowth,
      growthRate,
      rSquared,
      samples,
      message,
      intervals,
      graphData,
      durationMs,
      requestsPerSecond,
    };
  }

  /**
   * Generate interval-based measurements for detailed analysis.
   */
  private generateIntervals(samples: number[], intervalSize: number): IntervalMeasurement[] {
    const intervals: IntervalMeasurement[] = [];
    const numIntervals = Math.ceil(samples.length / intervalSize);

    for (let i = 0; i < numIntervals; i++) {
      const startIdx = i * intervalSize;
      const endIdx = Math.min((i + 1) * intervalSize - 1, samples.length - 1);

      if (startIdx >= samples.length) break;

      const heapAtStart = samples[startIdx];
      const heapAtEnd = samples[endIdx];
      const delta = heapAtEnd - heapAtStart;
      const iterationsInInterval = endIdx - startIdx + 1;
      const growthRatePerIteration = iterationsInInterval > 1 ? delta / (iterationsInInterval - 1) : 0;

      intervals.push({
        startIteration: startIdx,
        endIteration: endIdx,
        heapAtStart,
        heapAtEnd,
        delta,
        deltaFormatted: formatBytes(delta),
        growthRatePerIteration,
      });
    }

    return intervals;
  }

  /**
   * Generate graph data points for visualization.
   */
  private generateGraphData(samples: number[]): MemoryGraphPoint[] {
    if (samples.length === 0) return [];

    const baselineHeap = samples[0];

    return samples.map((heapUsed, iteration) => ({
      iteration,
      heapUsed,
      heapUsedFormatted: formatBytes(heapUsed),
      cumulativeDelta: heapUsed - baselineHeap,
      cumulativeDeltaFormatted: formatBytes(heapUsed - baselineHeap),
    }));
  }
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Quick leak check helper function.
 * Returns true if no leak detected, throws if leak detected.
 */
export async function assertNoLeak(
  operation: () => Promise<void>,
  options?: LeakDetectionOptions,
): Promise<LeakDetectionResult> {
  const detector = new LeakDetector();
  const result = await detector.detectLeak(operation, options);

  if (result.hasLeak) {
    throw new Error(`Memory leak detected: ${result.message}`);
  }

  return result;
}

/**
 * Create a LeakDetector instance.
 */
export function createLeakDetector(): LeakDetector {
  return new LeakDetector();
}
