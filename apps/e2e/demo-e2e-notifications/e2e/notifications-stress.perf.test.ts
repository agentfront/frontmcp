/**
 * Sequential Stress Tests for Notifications System (1000 iterations)
 *
 * Tests notification operations under sustained sequential load
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Notifications Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-notifications/src/main.ts',
    project: 'demo-e2e-notifications',
    publicMode: true,
  });

  perfTest('stress test: 1000 trigger-progress operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('trigger-progress', {
          level: 'info',
          message: `Progress update ${counter++}`,
        });
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
      `[STRESS] trigger-progress: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 trigger-resource-change operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('trigger-resource-change', {
          resourceUri: `test://resource-${counter++ % 10}`,
        });
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] trigger-resource-change: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 mixed notification operations', async ({ mcp, perf }) => {
    let callIndex = 0;
    const levels = ['debug', 'info', 'notice', 'warning', 'error'] as const;
    const result = await perf.checkLeak(
      async () => {
        const op = callIndex++ % 2;
        if (op === 0) {
          await mcp.tools.call('trigger-progress', {
            level: levels[callIndex % levels.length],
            message: `Message ${callIndex}`,
          });
        } else {
          await mcp.tools.call('trigger-resource-change', {
            resourceUri: `test://resource-${callIndex % 10}`,
          });
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
      `[STRESS] mixed operations: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 tool listings', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.list();
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] tools.list: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });
});
