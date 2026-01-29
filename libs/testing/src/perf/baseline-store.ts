/**
 * @file baseline-store.ts
 * @description Baseline storage for performance regression testing
 *
 * Baselines are stored as GitHub release comments and local JSON files.
 * The storage format uses special markers for parsing:
 *
 * <!-- PERF_BASELINE_START -->
 * ```json
 * { ... baseline data ... }
 * ```
 * <!-- PERF_BASELINE_END -->
 */

import type { PerfBaseline, TestBaseline, MetricBaseline, PerfMeasurement } from './types';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const BASELINE_START_MARKER = '<!-- PERF_BASELINE_START -->';
const BASELINE_END_MARKER = '<!-- PERF_BASELINE_END -->';
const DEFAULT_BASELINE_PATH = 'perf-results/baseline.json';

// ═══════════════════════════════════════════════════════════════════
// BASELINE STORE CLASS
// ═══════════════════════════════════════════════════════════════════

/**
 * Manages performance baselines stored in local files or GitHub releases.
 */
export class BaselineStore {
  private baseline: PerfBaseline | null = null;
  private readonly baselinePath: string;

  constructor(baselinePath: string = DEFAULT_BASELINE_PATH) {
    this.baselinePath = baselinePath;
  }

  /**
   * Load baseline from local file.
   */
  async load(): Promise<PerfBaseline | null> {
    try {
      const { readFile, fileExists } = await import('@frontmcp/utils');
      if (!(await fileExists(this.baselinePath))) {
        return null;
      }
      const content = await readFile(this.baselinePath);
      this.baseline = JSON.parse(content) as PerfBaseline;
      return this.baseline;
    } catch {
      return null;
    }
  }

  /**
   * Save baseline to local file.
   */
  async save(baseline: PerfBaseline): Promise<void> {
    const { writeFile, ensureDir } = await import('@frontmcp/utils');
    const dir = this.baselinePath.substring(0, this.baselinePath.lastIndexOf('/'));
    await ensureDir(dir);
    await writeFile(this.baselinePath, JSON.stringify(baseline, null, 2));
    this.baseline = baseline;
  }

  /**
   * Get a test baseline by ID.
   */
  getTestBaseline(testId: string): TestBaseline | null {
    if (!this.baseline) {
      return null;
    }
    return this.baseline.tests[testId] ?? null;
  }

  /**
   * Check if baseline is loaded.
   */
  isLoaded(): boolean {
    return this.baseline !== null;
  }

  /**
   * Get the loaded baseline.
   */
  getBaseline(): PerfBaseline | null {
    return this.baseline;
  }

  /**
   * Create a baseline from measurements.
   */
  static createFromMeasurements(measurements: PerfMeasurement[], release: string, commitHash?: string): PerfBaseline {
    const tests: Record<string, TestBaseline> = {};

    // Group measurements by test name
    const grouped = new Map<string, PerfMeasurement[]>();
    for (const m of measurements) {
      const key = `${m.project}::${m.name}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(m);
    }

    // Create baselines for each test
    for (const [key, testMeasurements] of grouped) {
      const [project, name] = key.split('::');

      const heapSamples = testMeasurements.map((m) => m.final?.memory.heapUsed ?? 0);
      const durationSamples = testMeasurements.map((m) => m.timing.durationMs);
      const cpuSamples = testMeasurements.map((m) => m.final?.cpu.total ?? 0);

      tests[key] = {
        testId: key,
        project,
        heapUsed: calculateMetricBaseline(heapSamples),
        durationMs: calculateMetricBaseline(durationSamples),
        cpuTime: calculateMetricBaseline(cpuSamples),
        createdAt: new Date().toISOString(),
        commitHash,
      };
    }

    return {
      release,
      timestamp: new Date().toISOString(),
      commitHash,
      tests,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// GITHUB RELEASE UTILITIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse baseline JSON from a release comment body.
 */
export function parseBaselineFromComment(commentBody: string): PerfBaseline | null {
  const startIdx = commentBody.indexOf(BASELINE_START_MARKER);
  const endIdx = commentBody.indexOf(BASELINE_END_MARKER);

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    return null;
  }

  const content = commentBody.substring(startIdx + BASELINE_START_MARKER.length, endIdx);

  // Extract JSON from markdown code block
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[1]) as PerfBaseline;
  } catch {
    return null;
  }
}

/**
 * Format baseline as a GitHub release comment.
 */
export function formatBaselineAsComment(baseline: PerfBaseline): string {
  const json = JSON.stringify(baseline, null, 2);
  return `## Performance Baseline

This comment contains the performance baseline for release ${baseline.release}.

${BASELINE_START_MARKER}
\`\`\`json
${json}
\`\`\`
${BASELINE_END_MARKER}

Generated at: ${baseline.timestamp}
${baseline.commitHash ? `Commit: ${baseline.commitHash}` : ''}
`;
}

/**
 * Build the GitHub API URL for release comments.
 */
export function buildReleaseCommentsUrl(owner: string, repo: string, releaseId: number): string {
  return `https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}/comments`;
}

// ═══════════════════════════════════════════════════════════════════
// STATISTICS HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Calculate baseline statistics for a metric.
 */
function calculateMetricBaseline(samples: number[]): MetricBaseline {
  if (samples.length === 0) {
    return {
      mean: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      p95: 0,
      sampleCount: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;

  // Mean
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  // Standard deviation
  const squaredDiffs = sorted.map((x) => Math.pow(x - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(variance);

  // Min, max
  const min = sorted[0];
  const max = sorted[n - 1];

  // P95
  const p95Index = Math.ceil(n * 0.95) - 1;
  const p95 = sorted[Math.min(p95Index, n - 1)];

  return {
    mean,
    stdDev,
    min,
    max,
    p95,
    sampleCount: n,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════

let globalBaselineStore: BaselineStore | null = null;

/**
 * Get the global baseline store instance.
 */
export function getBaselineStore(baselinePath?: string): BaselineStore {
  if (!globalBaselineStore || baselinePath) {
    globalBaselineStore = new BaselineStore(baselinePath);
  }
  return globalBaselineStore;
}

/**
 * Reset the global baseline store.
 */
export function resetBaselineStore(): void {
  globalBaselineStore = null;
}
