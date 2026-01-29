/**
 * Sequential Stress Tests for Remote Gateway System (1000 iterations)
 *
 * Tests remote gateway operations under sustained sequential load.
 * The remote gateway orchestrates local:* and mintlify:* namespaced tools.
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Remote Gateway Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-remote/src/main.ts',
    project: 'demo-e2e-remote',
    publicMode: true,
  });

  perfTest('stress test: 1000 local:echo operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('local:echo', { message: 'stress-test' });
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
      `[STRESS] local:echo: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 local:ping operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('local:ping', {});
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] local:ping: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 local:add operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('local:add', { a: counter++, b: 10 });
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] local:add: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 mixed remote operations', async ({ mcp, perf }) => {
    let callIndex = 0;
    const result = await perf.checkLeak(
      async () => {
        const op = callIndex++ % 3;
        if (op === 0) {
          await mcp.tools.call('local:echo', { message: 'test' });
        } else if (op === 1) {
          await mcp.tools.call('local:ping', {});
        } else {
          await mcp.tools.call('local:add', { a: 5, b: 10 });
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
      `[STRESS] mixed remote: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
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
