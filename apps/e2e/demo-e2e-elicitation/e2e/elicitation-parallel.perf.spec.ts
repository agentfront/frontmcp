/**
 * Parallel Stress Tests for Elicitation System (5 workers × 1000 iterations)
 *
 * Tests elicitation system under parallel load using multiple clients.
 * Note: Only tools.list is tested since this server only exposes tools (no resources/prompts).
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Elicitation Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-elicitation/src/main.ts',
    project: 'demo-e2e-elicitation',
    publicMode: true,
  });

  perfTest('parallel stress: 5000 total tool listings', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.list();
      },
      {
        iterations: 1000,
        workers: 5,
        threshold: 200 * 1024 * 1024, // 200MB for 5000 total operations
        warmupIterations: 10,
        intervalSize: 200,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] tools.list: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });
});
