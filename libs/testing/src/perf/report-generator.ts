/**
 * @file report-generator.ts
 * @description Generate JSON and Markdown reports from performance measurements
 */

import type {
  PerfReport,
  PerfTestSummary,
  ProjectSummary,
  PerfMeasurement,
  PerfBaseline,
  ParallelLeakDetectionResult,
} from './types';
import { RegressionDetector } from './regression-detector';
import { formatBytes, formatDuration, formatMicroseconds } from './metrics-collector';

// ═══════════════════════════════════════════════════════════════════
// REPORT GENERATOR CLASS
// ═══════════════════════════════════════════════════════════════════

/**
 * Generates performance reports in JSON and Markdown formats.
 */
export class ReportGenerator {
  private readonly detector: RegressionDetector;

  constructor() {
    this.detector = new RegressionDetector();
  }

  /**
   * Generate a complete performance report.
   */
  generateReport(
    measurements: PerfMeasurement[],
    baseline?: PerfBaseline,
    gitInfo?: { commitHash?: string; branch?: string },
  ): PerfReport {
    // Group measurements by project
    const projectGroups = new Map<string, PerfMeasurement[]>();
    for (const m of measurements) {
      if (!projectGroups.has(m.project)) {
        projectGroups.set(m.project, []);
      }
      const group = projectGroups.get(m.project);
      if (group) {
        group.push(m);
      }
    }

    // Build project summaries
    const projects: ProjectSummary[] = [];
    for (const [projectName, projectMeasurements] of projectGroups) {
      const summary = this.calculateSummary(projectMeasurements);
      const regressions = baseline ? this.detector.detectRegressions(projectMeasurements, baseline) : undefined;

      projects.push({
        project: projectName,
        summary,
        measurements: projectMeasurements,
        regressions,
      });
    }

    // Calculate overall summary
    const overallSummary = this.calculateSummary(measurements);

    return {
      timestamp: new Date().toISOString(),
      commitHash: gitInfo?.commitHash,
      branch: gitInfo?.branch,
      summary: overallSummary,
      projects,
      baseline: baseline ? { release: baseline.release, timestamp: baseline.timestamp } : undefined,
    };
  }

  /**
   * Generate Markdown report for PR comments.
   */
  generateMarkdownReport(report: PerfReport): string {
    const lines: string[] = [];

    // Header
    lines.push('## Performance Test Results');
    lines.push('');

    // Overall status
    const statusEmoji = this.getStatusEmoji(report.summary);
    lines.push(`**Status:** ${statusEmoji} ${this.getSummaryText(report.summary)}`);
    lines.push('');

    // Summary table
    lines.push('### Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total Tests | ${report.summary.totalTests} |`);
    lines.push(`| Passed | ${report.summary.passedTests} |`);
    lines.push(`| Warnings | ${report.summary.warningTests} |`);
    lines.push(`| Failed | ${report.summary.failedTests} |`);
    lines.push(`| Memory Leaks | ${report.summary.leakTests} |`);
    lines.push('');

    // Baseline info
    if (report.baseline) {
      lines.push(`**Baseline:** ${report.baseline.release} (${report.baseline.timestamp})`);
      lines.push('');
    }

    // Per-project breakdown
    lines.push('### Project Breakdown');
    lines.push('');

    for (const project of report.projects) {
      lines.push(`#### ${project.project}`);
      lines.push('');
      lines.push(this.generateProjectTable(project));
      lines.push('');

      // Show leak detection interval breakdown
      const leakTests = project.measurements.filter((m) => m.leakDetectionResults && m.leakDetectionResults.length > 0);
      if (leakTests.length > 0) {
        // Check for parallel tests
        const parallelTests = leakTests.filter((m) => m.leakDetectionResults?.some((r) => this.isParallelResult(r)));

        if (parallelTests.length > 0) {
          lines.push('**Parallel Stress Test Results:**');
          lines.push('');
          lines.push('| Test | Workers | Iterations | Duration | Total req/s |');
          lines.push('|------|---------|------------|----------|-------------|');
          for (const m of parallelTests) {
            for (const result of m.leakDetectionResults || []) {
              if (this.isParallelResult(result)) {
                const parallelResult = result as ParallelLeakDetectionResult;
                const durationStr = parallelResult.durationMs
                  ? `${(parallelResult.durationMs / 1000).toFixed(2)}s`
                  : 'N/A';
                lines.push(
                  `| ${m.name} | ${parallelResult.workersUsed} | ${parallelResult.totalIterations} | ${durationStr} | ${parallelResult.totalRequestsPerSecond.toFixed(1)} |`,
                );
              }
            }
          }
          lines.push('');
        }

        lines.push('**Memory Interval Analysis:**');
        lines.push('');
        for (const m of leakTests) {
          for (const result of m.leakDetectionResults || []) {
            if (result.intervals && result.intervals.length > 0) {
              lines.push(`*${m.name}:*`);
              lines.push('');

              // Show parallel worker stats if available
              if (this.isParallelResult(result)) {
                const parallelResult = result as ParallelLeakDetectionResult;
                lines.push('| Worker | req/s | Iterations |');
                lines.push('|--------|-------|------------|');
                for (const worker of parallelResult.perWorkerStats) {
                  lines.push(
                    `| ${worker.workerId} | ${worker.requestsPerSecond.toFixed(1)} | ${worker.iterationsCompleted} |`,
                  );
                }
                lines.push('');
              }

              lines.push('| Interval | Heap Start | Heap End | Delta | Rate/iter |');
              lines.push('|----------|------------|----------|-------|-----------|');
              for (const interval of result.intervals) {
                lines.push(
                  `| ${interval.startIteration}-${interval.endIteration} | ${formatBytes(interval.heapAtStart)} | ${formatBytes(interval.heapAtEnd)} | ${interval.deltaFormatted} | ${formatBytes(interval.growthRatePerIteration)}/iter |`,
                );
              }
              lines.push('');
              const durationStr = result.durationMs ? `${(result.durationMs / 1000).toFixed(2)}s` : 'N/A';
              const rpsStr = result.requestsPerSecond ? `${result.requestsPerSecond.toFixed(1)} req/s` : 'N/A';
              lines.push(
                `Total: ${formatBytes(result.totalGrowth)}, R²=${result.rSquared.toFixed(3)} | ` +
                  `${result.samples.length} iterations in ${durationStr} (${rpsStr})`,
              );
              lines.push('');
            }
          }
        }
      }

      // Show regressions if any
      if (project.regressions && project.regressions.length > 0) {
        const regressionsWithIssues = project.regressions.filter((r) => r.status !== 'ok');
        if (regressionsWithIssues.length > 0) {
          lines.push('**Regressions:**');
          for (const r of regressionsWithIssues) {
            const emoji = r.status === 'regression' ? '!' : '!';
            lines.push(`- ${emoji} ${r.message}`);
          }
          lines.push('');
        }
      }
    }

    // Footer
    lines.push('---');
    lines.push(`Generated at: ${report.timestamp}`);
    if (report.commitHash) {
      lines.push(`Commit: \`${report.commitHash.substring(0, 8)}\``);
    }
    if (report.branch) {
      lines.push(`Branch: \`${report.branch}\``);
    }

    return lines.join('\n');
  }

  /**
   * Generate JSON report.
   */
  generateJsonReport(report: PerfReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Calculate summary statistics for measurements.
   */
  private calculateSummary(measurements: PerfMeasurement[]): PerfTestSummary {
    let passedTests = 0;
    let warningTests = 0;
    let failedTests = 0;
    let leakTests = 0;

    for (const m of measurements) {
      const hasError = m.issues.some((i) => i.severity === 'error');
      const hasWarning = m.issues.some((i) => i.severity === 'warning');
      const hasLeak = m.issues.some((i) => i.type === 'memory-leak');

      if (hasLeak) {
        leakTests++;
      }

      if (hasError) {
        failedTests++;
      } else if (hasWarning) {
        warningTests++;
      } else {
        passedTests++;
      }
    }

    return {
      totalTests: measurements.length,
      passedTests,
      warningTests,
      failedTests,
      leakTests,
    };
  }

  /**
   * Get status emoji based on summary.
   */
  private getStatusEmoji(summary: PerfTestSummary): string {
    if (summary.failedTests > 0 || summary.leakTests > 0) {
      return 'X';
    }
    if (summary.warningTests > 0) {
      return '!';
    }
    return 'OK';
  }

  /**
   * Get summary text.
   */
  private getSummaryText(summary: PerfTestSummary): string {
    if (summary.failedTests > 0) {
      return `${summary.failedTests} test(s) failed`;
    }
    if (summary.leakTests > 0) {
      return `${summary.leakTests} memory leak(s) detected`;
    }
    if (summary.warningTests > 0) {
      return `${summary.warningTests} warning(s)`;
    }
    return 'All tests passed';
  }

  /**
   * Generate markdown table for project measurements.
   */
  private generateProjectTable(project: ProjectSummary): string {
    const lines: string[] = [];

    lines.push('| Test | Duration | Heap Delta | CPU Time | Status |');
    lines.push('|------|----------|------------|----------|--------|');

    for (const m of project.measurements) {
      const status = this.getTestStatus(m);
      const heapDelta = m.memoryDelta ? formatBytes(m.memoryDelta.heapUsed) : 'N/A';
      const cpuTime = m.final?.cpu.total ? formatMicroseconds(m.final.cpu.total) : 'N/A';

      lines.push(`| ${m.name} | ${formatDuration(m.timing.durationMs)} | ${heapDelta} | ${cpuTime} | ${status} |`);
    }

    return lines.join('\n');
  }

  /**
   * Get test status indicator.
   */
  private getTestStatus(m: PerfMeasurement): string {
    const hasError = m.issues.some((i) => i.severity === 'error');
    const hasLeak = m.issues.some((i) => i.type === 'memory-leak');
    const hasWarning = m.issues.some((i) => i.severity === 'warning');

    if (hasLeak) {
      return 'LEAK';
    }
    if (hasError) {
      return 'FAIL';
    }
    if (hasWarning) {
      return 'WARN';
    }
    return 'OK';
  }

  /**
   * Check if a leak detection result is a parallel result.
   */
  private isParallelResult(result: unknown): result is ParallelLeakDetectionResult {
    return (
      typeof result === 'object' &&
      result !== null &&
      'workersUsed' in result &&
      'perWorkerStats' in result &&
      'totalRequestsPerSecond' in result
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate and save reports to files.
 */
export async function saveReports(
  measurements: PerfMeasurement[],
  outputDir: string,
  baseline?: PerfBaseline,
  gitInfo?: { commitHash?: string; branch?: string },
): Promise<{ jsonPath: string; markdownPath: string }> {
  const { writeFile, ensureDir } = await import('@frontmcp/utils');

  await ensureDir(outputDir);

  const generator = new ReportGenerator();
  const report = generator.generateReport(measurements, baseline, gitInfo);

  const jsonPath = `${outputDir}/report.json`;
  const markdownPath = `${outputDir}/report.md`;

  await writeFile(jsonPath, generator.generateJsonReport(report));
  await writeFile(markdownPath, generator.generateMarkdownReport(report));

  return { jsonPath, markdownPath };
}

/**
 * Create a report generator instance.
 */
export function createReportGenerator(): ReportGenerator {
  return new ReportGenerator();
}
