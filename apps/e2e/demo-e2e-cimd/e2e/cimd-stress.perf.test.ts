/**
 * Sequential Stress Tests for CIMD System (1000 iterations)
 *
 * Tests CIMD operations under sustained sequential load.
 * Note: CIMD requires authentication, so tests focus on discovery operations
 * that work without full auth flow.
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('CIMD Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-cimd/src/main.ts',
    project: 'demo-e2e-cimd',
    publicMode: true,
  });

  perfTest('stress test: 1000 tools.list discovery operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.list();
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB for 1000 iterations
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    // Log performance stats
    console.log(
      `[STRESS] tools.list: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 resources.list discovery operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.resources.list();
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] resources.list: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 prompts.list discovery operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.prompts.list();
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] prompts.list: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 mixed discovery operations', async ({ mcp, perf }) => {
    let callIndex = 0;
    const result = await perf.checkLeak(
      async () => {
        const op = callIndex++ % 3;
        if (op === 0) {
          await mcp.tools.list();
        } else if (op === 1) {
          await mcp.resources.list();
        } else {
          await mcp.prompts.list();
        }
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] mixed discovery: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });
});
