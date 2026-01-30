/**
 * @file jest-perf-reporter.ts
 * @description Custom Jest reporter for collecting and outputting performance measurements
 */

import type { Config, Reporter, TestResult, AggregatedResult, TestContext } from '@jest/reporters';
import type { Test } from '@jest/test-result';
import { getGlobalMeasurements, clearGlobalMeasurements } from './perf-fixtures';
import { ReportGenerator, saveReports } from './report-generator';
import { getBaselineStore } from './baseline-store';
import type { PerfMeasurement, PerfBaseline } from './types';

// ═══════════════════════════════════════════════════════════════════
// JEST PERF REPORTER
// ═══════════════════════════════════════════════════════════════════

/**
 * Custom Jest reporter that collects performance measurements and generates reports.
 *
 * Usage in jest.perf.config.ts:
 * ```typescript
 * {
 *   reporters: [
 *     'default',
 *     ['<rootDir>/libs/testing/src/perf/jest-perf-reporter.ts', {
 *       outputDir: 'perf-results',
 *       baselinePath: 'perf-results/baseline.json',
 *     }]
 *   ]
 * }
 * ```
 */
class JestPerfReporter implements Reporter {
  private readonly outputDir: string;
  private readonly baselinePath: string;
  private readonly verbose: boolean;
  private measurements: PerfMeasurement[] = [];
  private baseline: PerfBaseline | null = null;

  constructor(
    _globalConfig: Config.GlobalConfig,
    reporterOptions: {
      outputDir?: string;
      baselinePath?: string;
      verbose?: boolean;
    } = {},
  ) {
    this.outputDir = reporterOptions.outputDir ?? 'perf-results';
    this.baselinePath = reporterOptions.baselinePath ?? 'perf-results/baseline.json';
    this.verbose = reporterOptions.verbose ?? false;
  }

  /**
   * Called before running tests.
   */
  async onRunStart(): Promise<void> {
    // Clear any existing measurements
    clearGlobalMeasurements();
    this.measurements = [];

    // Try to load baseline
    const store = getBaselineStore(this.baselinePath);
    this.baseline = await store.load();

    if (this.baseline && this.verbose) {
      console.log(`[PerfReporter] Loaded baseline from ${this.baseline.release} (${this.baseline.timestamp})`);
    }
  }

  /**
   * Called after each test file completes.
   */
  onTestFileResult(_test: Test, _testResult: TestResult): void {
    // Collect measurements from this test file
    const fileMeasurements = getGlobalMeasurements();
    this.measurements.push(...fileMeasurements);

    if (this.verbose && fileMeasurements.length > 0) {
      console.log(`[PerfReporter] Collected ${fileMeasurements.length} measurements from test file`);
    }

    // Clear for next file
    clearGlobalMeasurements();
  }

  /**
   * Called after all tests complete.
   */
  async onRunComplete(_testContexts: Set<TestContext>, _results: AggregatedResult): Promise<void> {
    if (this.measurements.length === 0) {
      if (this.verbose) {
        console.log('[PerfReporter] No performance measurements collected');
      }
      return;
    }

    console.log(`\n[PerfReporter] Generating reports for ${this.measurements.length} measurements...`);

    try {
      // Get git info if available
      const gitInfo = await this.getGitInfo();

      // Generate and save reports
      const { jsonPath, markdownPath } = await saveReports(
        this.measurements,
        this.outputDir,
        this.baseline ?? undefined,
        gitInfo,
      );

      console.log(`[PerfReporter] JSON report: ${jsonPath}`);
      console.log(`[PerfReporter] Markdown report: ${markdownPath}`);

      // Print summary
      this.printSummary();
    } catch (error) {
      console.error('[PerfReporter] Failed to generate reports:', error);
    }
  }

  /**
   * Print a summary to the console.
   */
  private printSummary(): void {
    const generator = new ReportGenerator();
    const report = generator.generateReport(this.measurements, this.baseline ?? undefined);

    console.log('\n========================================');
    console.log('PERFORMANCE TEST SUMMARY');
    console.log('========================================');
    console.log(`Total Tests:    ${report.summary.totalTests}`);
    console.log(`Passed:         ${report.summary.passedTests}`);
    console.log(`Warnings:       ${report.summary.warningTests}`);
    console.log(`Failed:         ${report.summary.failedTests}`);
    console.log(`Memory Leaks:   ${report.summary.leakTests}`);

    if (this.baseline) {
      console.log(`\nBaseline: ${this.baseline.release}`);
    }

    // Show regressions
    if (this.baseline) {
      const allRegressions = report.projects.flatMap((p) => p.regressions ?? []);
      const issueRegressions = allRegressions.filter((r) => r.status !== 'ok');

      if (issueRegressions.length > 0) {
        console.log('\nRegressions:');
        for (const r of issueRegressions) {
          const icon = r.status === 'regression' ? '[!]' : '[~]';
          console.log(`  ${icon} ${r.message}`);
        }
      }
    }

    console.log('========================================\n');
  }

  /**
   * Get git info from environment or git commands.
   */
  private async getGitInfo(): Promise<{ commitHash?: string; branch?: string }> {
    // Check environment variables first (set by CI)
    let commitHash: string | undefined =
      process.env['GITHUB_SHA'] ?? process.env['GIT_COMMIT'] ?? process.env['CI_COMMIT_SHA'];
    let branch: string | undefined =
      process.env['GITHUB_REF_NAME'] ?? process.env['GIT_BRANCH'] ?? process.env['CI_COMMIT_BRANCH'];

    // Try to get from git commands if not already set
    if (!commitHash || !branch) {
      try {
        const { execSync } = await import('child_process');
        if (!commitHash) {
          commitHash = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim() || undefined;
        }
        if (!branch) {
          branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim() || undefined;
        }
      } catch {
        // Git commands failed, that's ok
      }
    }

    return { commitHash, branch };
  }

  /**
   * Get the final exit code hint.
   * Return void to not override Jest's default exit code.
   */
  getLastError(): void {
    // Check if there are any failures that should fail the build
    const hasFailures = this.measurements.some((m) => m.issues.some((i) => i.severity === 'error'));

    if (hasFailures && process.env['PERF_FAIL_ON_REGRESSION'] === 'true') {
      throw new Error('Performance tests failed');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// MODULE EXPORTS FOR JEST
// ═══════════════════════════════════════════════════════════════════

// Jest expects a default export for reporters
module.exports = JestPerfReporter;
