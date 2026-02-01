/**
 * @file types.ts
 * @description Type definitions for performance testing framework
 */

// ═══════════════════════════════════════════════════════════════════
// MEMORY METRICS
// ═══════════════════════════════════════════════════════════════════

/**
 * Memory metrics captured via process.memoryUsage()
 */
export interface MemoryMetrics {
  /** Used heap size in bytes */
  heapUsed: number;
  /** Total heap size in bytes */
  heapTotal: number;
  /** Memory used by C++ objects bound to JS objects */
  external: number;
  /** Resident set size (total memory allocated for the process) */
  rss: number;
  /** Memory used by ArrayBuffers and SharedArrayBuffers */
  arrayBuffers: number;
}

// ═══════════════════════════════════════════════════════════════════
// CPU METRICS
// ═══════════════════════════════════════════════════════════════════

/**
 * CPU metrics captured via process.cpuUsage()
 */
export interface CpuMetrics {
  /** User CPU time in microseconds */
  user: number;
  /** System CPU time in microseconds */
  system: number;
  /** Total CPU time (user + system) in microseconds */
  total: number;
}

// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE SNAPSHOT
// ═══════════════════════════════════════════════════════════════════

/**
 * A point-in-time performance snapshot
 */
export interface PerfSnapshot {
  /** Memory metrics at this point */
  memory: MemoryMetrics;
  /** CPU metrics since last measurement (or process start) */
  cpu: CpuMetrics;
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Optional label for this snapshot */
  label?: string;
}

// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE MEASUREMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * A complete performance measurement with baseline and samples
 */
export interface PerfMeasurement {
  /** Test name */
  name: string;
  /** Project/app name */
  project: string;
  /** Baseline snapshot (captured before test) */
  baseline: PerfSnapshot;
  /** All measurement snapshots during the test */
  measurements: PerfSnapshot[];
  /** Final snapshot (captured after test) */
  final?: PerfSnapshot;
  /** Timing information */
  timing: {
    /** Test start timestamp */
    startTime: number;
    /** Test end timestamp */
    endTime: number;
    /** Total duration in milliseconds */
    durationMs: number;
  };
  /** Memory delta (final - baseline) */
  memoryDelta?: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  /** Detected issues during this test */
  issues: PerfIssue[];
  /** Leak detection results (if checkLeak was called) */
  leakDetectionResults?: LeakDetectionResult[];
}

/**
 * A performance issue detected during testing
 */
export interface PerfIssue {
  /** Issue type */
  type: 'memory-leak' | 'threshold-exceeded' | 'regression' | 'warning';
  /** Issue severity */
  severity: 'error' | 'warning';
  /** Human-readable message */
  message: string;
  /** Metric that triggered the issue */
  metric?: string;
  /** Actual value that triggered the issue */
  actual?: number;
  /** Expected/threshold value */
  expected?: number;
}

// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE THRESHOLDS
// ═══════════════════════════════════════════════════════════════════

/**
 * Thresholds for performance assertions
 */
export interface PerfThresholds {
  /** Maximum heap delta in bytes (final - baseline) */
  maxHeapDelta?: number;
  /** Maximum test duration in milliseconds */
  maxDurationMs?: number;
  /** Maximum CPU time in microseconds */
  maxCpuTime?: number;
  /** Maximum RSS delta in bytes */
  maxRssDelta?: number;
}

// ═══════════════════════════════════════════════════════════════════
// LEAK DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Options for memory leak detection
 */
export interface LeakDetectionOptions {
  /** Number of iterations to run */
  iterations?: number;
  /** Memory growth threshold in bytes to consider a leak */
  threshold?: number;
  /** Warmup iterations (not counted) */
  warmupIterations?: number;
  /** Force GC between iterations */
  forceGc?: boolean;
  /** Delay between iterations in ms */
  delayMs?: number;
  /** Interval size for tracking memory growth (e.g., 10 means track 0-10, 10-20, etc.) */
  intervalSize?: number;
}

// ═══════════════════════════════════════════════════════════════════
// PARALLEL LEAK DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Per-worker statistics in parallel leak detection
 */
export interface WorkerStats {
  /** Worker index (0-based) */
  workerId: number;
  /** Requests per second for this worker */
  requestsPerSecond: number;
  /** Memory samples collected by this worker */
  samples: number[];
  /** Duration in milliseconds for this worker */
  durationMs: number;
  /** Number of iterations completed */
  iterationsCompleted: number;
}

/**
 * Client interface for parallel leak detection (minimal interface)
 */
export interface ParallelTestClient {
  tools: {
    call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    list: () => Promise<unknown>;
  };
  resources: {
    read: (uri: string) => Promise<unknown>;
  };
  disconnect?: () => Promise<void>;
}

/**
 * Options for parallel memory leak detection using multiple clients
 */
export interface ParallelLeakDetectionOptions extends LeakDetectionOptions {
  /** Number of parallel worker clients (default: 5) */
  workers?: number;
  /** Factory to create a new client for each worker (required for true parallelism) */
  clientFactory?: () => Promise<ParallelTestClient>;
}

/**
 * Result of parallel leak detection analysis
 */
export interface ParallelLeakDetectionResult extends LeakDetectionResult {
  /** Number of workers used */
  workersUsed: number;
  /** Combined throughput across all workers (req/s) */
  totalRequestsPerSecond: number;
  /** Per-worker statistics */
  perWorkerStats: WorkerStats[];
  /** Total iterations across all workers */
  totalIterations: number;
}

/**
 * Memory measurement at a specific interval
 */
export interface IntervalMeasurement {
  /** Start iteration of this interval */
  startIteration: number;
  /** End iteration of this interval */
  endIteration: number;
  /** Heap used at start of interval (bytes) */
  heapAtStart: number;
  /** Heap used at end of interval (bytes) */
  heapAtEnd: number;
  /** Memory delta for this interval (bytes) */
  delta: number;
  /** Formatted delta string */
  deltaFormatted: string;
  /** Growth rate per iteration in this interval */
  growthRatePerIteration: number;
}

/**
 * Graph data point for visualization
 */
export interface MemoryGraphPoint {
  /** Iteration number */
  iteration: number;
  /** Heap used at this iteration (bytes) */
  heapUsed: number;
  /** Heap used formatted */
  heapUsedFormatted: string;
  /** Cumulative delta from start (bytes) */
  cumulativeDelta: number;
  /** Cumulative delta formatted */
  cumulativeDeltaFormatted: string;
}

/**
 * Result of leak detection analysis
 */
export interface LeakDetectionResult {
  /** Whether a memory leak was detected */
  hasLeak: boolean;
  /** Estimated leak size in bytes per iteration */
  leakSizePerIteration: number;
  /** Total memory growth during test */
  totalGrowth: number;
  /** Growth rate (bytes per iteration) */
  growthRate: number;
  /** Linear regression R² value (1.0 = perfect linear growth) */
  rSquared: number;
  /** All heap measurements */
  samples: number[];
  /** Summary message */
  message: string;
  /** Interval-based measurements for detailed analysis */
  intervals?: IntervalMeasurement[];
  /** Graph data points for visualization */
  graphData?: MemoryGraphPoint[];
  /** Total duration of the leak detection test in milliseconds */
  durationMs?: number;
  /** Requests per second (iterations / duration in seconds) */
  requestsPerSecond?: number;
}

// ═══════════════════════════════════════════════════════════════════
// BASELINE STORAGE
// ═══════════════════════════════════════════════════════════════════

/**
 * Baseline statistics for a metric
 */
export interface MetricBaseline {
  /** Mean value */
  mean: number;
  /** Standard deviation */
  stdDev: number;
  /** Minimum observed value */
  min: number;
  /** Maximum observed value */
  max: number;
  /** 95th percentile */
  p95: number;
  /** Number of samples */
  sampleCount: number;
}

/**
 * Baseline data for a single test
 */
export interface TestBaseline {
  /** Test identifier */
  testId: string;
  /** Project name */
  project: string;
  /** Heap used baseline */
  heapUsed: MetricBaseline;
  /** Duration baseline */
  durationMs: MetricBaseline;
  /** CPU time baseline */
  cpuTime: MetricBaseline;
  /** When baseline was created */
  createdAt: string;
  /** Git commit hash */
  commitHash?: string;
}

/**
 * Complete baseline storage format
 */
export interface PerfBaseline {
  /** Release/version tag */
  release: string;
  /** When baselines were generated */
  timestamp: string;
  /** Git commit hash */
  commitHash?: string;
  /** All test baselines */
  tests: Record<string, TestBaseline>;
}

// ═══════════════════════════════════════════════════════════════════
// REGRESSION DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Configuration for regression detection
 */
export interface RegressionConfig {
  /** Warning threshold as percentage (default: 10) */
  warningThresholdPercent?: number;
  /** Error threshold as percentage (default: 25) */
  errorThresholdPercent?: number;
  /** Minimum absolute change to report (avoids noise on small values) */
  minAbsoluteChange?: number;
}

/**
 * Result of regression analysis for a single metric
 */
export interface MetricRegression {
  /** Metric name */
  metric: string;
  /** Baseline value */
  baseline: number;
  /** Current value */
  current: number;
  /** Change percentage */
  changePercent: number;
  /** Absolute change */
  absoluteChange: number;
  /** Regression status */
  status: 'ok' | 'warning' | 'regression';
}

/**
 * Complete regression analysis result
 */
export interface RegressionResult {
  /** Test identifier */
  testId: string;
  /** Overall status */
  status: 'ok' | 'warning' | 'regression';
  /** Individual metric regressions */
  metrics: MetricRegression[];
  /** Summary message */
  message: string;
}

// ═══════════════════════════════════════════════════════════════════
// REPORT TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Summary statistics for a test run
 */
export interface PerfTestSummary {
  /** Total tests run */
  totalTests: number;
  /** Tests that passed */
  passedTests: number;
  /** Tests with warnings */
  warningTests: number;
  /** Tests that failed */
  failedTests: number;
  /** Tests with detected memory leaks */
  leakTests: number;
}

/**
 * Per-project summary
 */
export interface ProjectSummary {
  /** Project name */
  project: string;
  /** Summary statistics */
  summary: PerfTestSummary;
  /** All measurements for this project */
  measurements: PerfMeasurement[];
  /** Regression results (if baseline available) */
  regressions?: RegressionResult[];
}

/**
 * Complete performance report
 */
export interface PerfReport {
  /** Report generation timestamp */
  timestamp: string;
  /** Git commit hash */
  commitHash?: string;
  /** Git branch name */
  branch?: string;
  /** Overall summary */
  summary: PerfTestSummary;
  /** Per-project breakdowns */
  projects: ProjectSummary[];
  /** Baseline used for comparison (if any) */
  baseline?: {
    release: string;
    timestamp: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// FIXTURE TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Performance fixture available in perfTest functions
 */
export interface PerfFixtures {
  /** Capture baseline snapshot */
  baseline(): Promise<PerfSnapshot>;
  /** Capture a measurement snapshot */
  measure(label?: string): PerfSnapshot;
  /** Run leak detection on an operation */
  checkLeak(operation: () => Promise<void>, options?: LeakDetectionOptions): Promise<LeakDetectionResult>;
  /**
   * Run parallel leak detection using multiple clients.
   * This achieves higher throughput by running N workers concurrently.
   *
   * @param operationFactory - Factory that receives a client and worker index, returns an operation function
   * @param options - Detection options including worker count and client factory
   * @returns Parallel leak detection result with combined throughput metrics
   *
   * @example
   * ```typescript
   * const result = await perf.checkLeakParallel(
   *   (client, workerId) => async () => {
   *     await client.tools.call('my-tool', { key: `worker-${workerId}` });
   *   },
   *   {
   *     iterations: 1000,
   *     workers: 5,
   *     clientFactory: () => server.createClient(),
   *   }
   * );
   * expect(result.totalRequestsPerSecond).toBeGreaterThan(300);
   * ```
   */
  checkLeakParallel(
    operationFactory: (client: ParallelTestClient, workerId: number) => () => Promise<void>,
    options: ParallelLeakDetectionOptions & { clientFactory: () => Promise<ParallelTestClient> },
  ): Promise<ParallelLeakDetectionResult>;
  /** Assert performance thresholds */
  assertThresholds(thresholds: PerfThresholds): void;
  /** Get all measurements so far */
  getMeasurements(): PerfSnapshot[];
  /** Get the current test name */
  getTestName(): string;
}

/**
 * Extended test fixtures including performance
 */
export interface PerfTestFixtures {
  /** Performance fixture */
  perf: PerfFixtures;
}

/**
 * Performance test configuration
 */
export interface PerfTestConfig {
  /** Server entry file path */
  server?: string;
  /** Project name */
  project?: string;
  /** Enable public mode */
  publicMode?: boolean;
  /** Default thresholds for all tests */
  defaultThresholds?: PerfThresholds;
  /** Force GC before baseline */
  forceGcOnBaseline?: boolean;
}
