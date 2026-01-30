/**
 * @file index.ts
 * @description Barrel exports for performance testing module
 *
 * @example Basic Usage
 * ```typescript
 * import { perfTest, expect } from '@frontmcp/testing';
 *
 * perfTest.describe('Cache Performance', () => {
 *   perfTest.use({
 *     server: 'apps/e2e/demo-e2e-cache/src/main.ts',
 *     project: 'demo-e2e-cache',
 *     publicMode: true,
 *   });
 *
 *   perfTest('cache operations memory overhead', async ({ mcp, perf }) => {
 *     await perf.baseline();
 *
 *     for (let i = 0; i < 100; i++) {
 *       await mcp.tools.call('expensive-operation', { operationId: `test-${i}` });
 *     }
 *
 *     perf.assertThresholds({ maxHeapDelta: 10 * 1024 * 1024 }); // 10MB
 *   });
 *
 *   perfTest('no memory leak on repeated cache hits', async ({ mcp, perf }) => {
 *     const result = await perf.checkLeak(
 *       () => mcp.tools.call('expensive-operation', { operationId: 'leak-test' }),
 *       { iterations: 50, threshold: 5 * 1024 * 1024 }
 *     );
 *     expect(result.hasLeak).toBe(false);
 *   });
 * });
 * ```
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type {
  // Memory & CPU
  MemoryMetrics,
  CpuMetrics,
  PerfSnapshot,

  // Measurements
  PerfMeasurement,
  PerfIssue,
  PerfThresholds,

  // Leak Detection
  LeakDetectionOptions,
  LeakDetectionResult,
  IntervalMeasurement,
  MemoryGraphPoint,

  // Parallel Leak Detection
  ParallelTestClient,
  WorkerStats,
  ParallelLeakDetectionOptions,
  ParallelLeakDetectionResult,

  // Baseline & Regression
  MetricBaseline,
  TestBaseline,
  PerfBaseline,
  RegressionConfig,
  MetricRegression,
  RegressionResult,

  // Reports
  PerfTestSummary,
  ProjectSummary,
  PerfReport,

  // Fixtures
  PerfFixtures,
  PerfTestFixtures,
  PerfTestConfig,
} from './types';

// ═══════════════════════════════════════════════════════════════════
// METRICS COLLECTOR
// ═══════════════════════════════════════════════════════════════════

export {
  MetricsCollector,
  isGcAvailable,
  forceGc,
  forceFullGc,
  formatBytes,
  formatMicroseconds,
  formatDuration,
  getGlobalCollector,
  resetGlobalCollector,
} from './metrics-collector';

// ═══════════════════════════════════════════════════════════════════
// LEAK DETECTOR
// ═══════════════════════════════════════════════════════════════════

export { LeakDetector, assertNoLeak, createLeakDetector } from './leak-detector';

// ═══════════════════════════════════════════════════════════════════
// PERF FIXTURES
// ═══════════════════════════════════════════════════════════════════

export {
  createPerfFixtures,
  PerfFixturesImpl,
  addGlobalMeasurement,
  getGlobalMeasurements,
  clearGlobalMeasurements,
  getMeasurementsForProject,
} from './perf-fixtures';

// ═══════════════════════════════════════════════════════════════════
// PERF TEST (Primary API)
// ═══════════════════════════════════════════════════════════════════

export { perfTest, type PerfTestFn, type PerfTestWithFixtures } from './perf-test';

// ═══════════════════════════════════════════════════════════════════
// BASELINE STORE
// ═══════════════════════════════════════════════════════════════════

export {
  BaselineStore,
  parseBaselineFromComment,
  formatBaselineAsComment,
  buildReleaseCommentsUrl,
  getBaselineStore,
  resetBaselineStore,
} from './baseline-store';

// ═══════════════════════════════════════════════════════════════════
// REGRESSION DETECTOR
// ═══════════════════════════════════════════════════════════════════

export {
  RegressionDetector,
  summarizeRegressions,
  filterByStatus,
  getMostSevereMetric,
  getRegressionDetector,
  resetRegressionDetector,
} from './regression-detector';

// ═══════════════════════════════════════════════════════════════════
// REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════════

export { ReportGenerator, saveReports, createReportGenerator } from './report-generator';
