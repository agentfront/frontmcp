/**
 * @file regression-detector.ts
 * @description Performance regression detection by comparing current metrics to baseline
 */

import type {
  RegressionConfig,
  RegressionResult,
  MetricRegression,
  PerfMeasurement,
  TestBaseline,
  PerfBaseline,
} from './types';
import { formatBytes, formatDuration, formatMicroseconds } from './metrics-collector';

// ═══════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: Required<RegressionConfig> = {
  warningThresholdPercent: 10,
  errorThresholdPercent: 25,
  minAbsoluteChange: 1024, // 1KB minimum to avoid noise
};

// ═══════════════════════════════════════════════════════════════════
// REGRESSION DETECTOR CLASS
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects performance regressions by comparing current metrics to baseline.
 */
export class RegressionDetector {
  private readonly config: Required<RegressionConfig>;

  constructor(config?: RegressionConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect regressions in a measurement compared to baseline.
   */
  detectRegression(measurement: PerfMeasurement, baseline: TestBaseline): RegressionResult {
    const testId = `${measurement.project}::${measurement.name}`;
    const metrics: MetricRegression[] = [];

    // Check heap used
    const currentHeap = measurement.final?.memory.heapUsed ?? 0;
    const heapRegression = this.checkMetric('heapUsed', baseline.heapUsed.mean, currentHeap, formatBytes);
    metrics.push(heapRegression);

    // Check duration
    const durationRegression = this.checkMetric(
      'durationMs',
      baseline.durationMs.mean,
      measurement.timing.durationMs,
      formatDuration,
    );
    metrics.push(durationRegression);

    // Check CPU time
    const currentCpu = measurement.final?.cpu.total ?? 0;
    const cpuRegression = this.checkMetric('cpuTime', baseline.cpuTime.mean, currentCpu, formatMicroseconds);
    metrics.push(cpuRegression);

    // Determine overall status
    const hasRegression = metrics.some((m) => m.status === 'regression');
    const hasWarning = metrics.some((m) => m.status === 'warning');
    const status = hasRegression ? 'regression' : hasWarning ? 'warning' : 'ok';

    // Build message
    const message = this.buildMessage(testId, metrics, status);

    return {
      testId,
      status,
      metrics,
      message,
    };
  }

  /**
   * Detect regressions for multiple measurements.
   */
  detectRegressions(measurements: PerfMeasurement[], baselines: PerfBaseline): RegressionResult[] {
    const results: RegressionResult[] = [];

    for (const measurement of measurements) {
      const testId = `${measurement.project}::${measurement.name}`;
      const baseline = baselines.tests[testId];

      if (baseline) {
        results.push(this.detectRegression(measurement, baseline));
      }
    }

    return results;
  }

  /**
   * Check a single metric for regression.
   */
  private checkMetric(
    name: string,
    baseline: number,
    current: number,
    _formatter: (value: number) => string,
  ): MetricRegression {
    const absoluteChange = current - baseline;
    const changePercent = baseline > 0 ? (absoluteChange / baseline) * 100 : 0;

    let status: 'ok' | 'warning' | 'regression' = 'ok';

    // Only flag if absolute change exceeds minimum threshold
    if (Math.abs(absoluteChange) > this.config.minAbsoluteChange) {
      if (changePercent >= this.config.errorThresholdPercent) {
        status = 'regression';
      } else if (changePercent >= this.config.warningThresholdPercent) {
        status = 'warning';
      }
    }

    return {
      metric: name,
      baseline,
      current,
      changePercent,
      absoluteChange,
      status,
    };
  }

  /**
   * Build a human-readable message for regression result.
   */
  private buildMessage(testId: string, metrics: MetricRegression[], status: 'ok' | 'warning' | 'regression'): string {
    if (status === 'ok') {
      return `${testId}: All metrics within acceptable range`;
    }

    const issues = metrics
      .filter((m) => m.status !== 'ok')
      .map((m) => {
        const direction = m.absoluteChange > 0 ? '+' : '';
        return `${m.metric}: ${direction}${m.changePercent.toFixed(1)}%`;
      });

    const statusText = status === 'regression' ? 'REGRESSION' : 'WARNING';
    return `${testId}: ${statusText} - ${issues.join(', ')}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Summarize regression results.
 */
export function summarizeRegressions(results: RegressionResult[]): {
  total: number;
  ok: number;
  warnings: number;
  regressions: number;
  summary: string;
} {
  const total = results.length;
  const ok = results.filter((r) => r.status === 'ok').length;
  const warnings = results.filter((r) => r.status === 'warning').length;
  const regressions = results.filter((r) => r.status === 'regression').length;

  let summary: string;
  if (regressions > 0) {
    summary = `${regressions} regression(s) detected out of ${total} tests`;
  } else if (warnings > 0) {
    summary = `${warnings} warning(s) detected out of ${total} tests`;
  } else {
    summary = `All ${total} tests within acceptable range`;
  }

  return { total, ok, warnings, regressions, summary };
}

/**
 * Filter regressions by status.
 */
export function filterByStatus(
  results: RegressionResult[],
  status: 'ok' | 'warning' | 'regression',
): RegressionResult[] {
  return results.filter((r) => r.status === status);
}

/**
 * Get the most severe metric regression from a result.
 */
export function getMostSevereMetric(result: RegressionResult): MetricRegression | null {
  const regressions = result.metrics.filter((m) => m.status === 'regression');
  if (regressions.length > 0) {
    return regressions.reduce((max, m) => (m.changePercent > max.changePercent ? m : max));
  }

  const warnings = result.metrics.filter((m) => m.status === 'warning');
  if (warnings.length > 0) {
    return warnings.reduce((max, m) => (m.changePercent > max.changePercent ? m : max));
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════

let globalDetector: RegressionDetector | null = null;

/**
 * Get the global regression detector instance.
 */
export function getRegressionDetector(config?: RegressionConfig): RegressionDetector {
  if (!globalDetector || config) {
    globalDetector = new RegressionDetector(config);
  }
  return globalDetector;
}

/**
 * Reset the global regression detector.
 */
export function resetRegressionDetector(): void {
  globalDetector = null;
}
