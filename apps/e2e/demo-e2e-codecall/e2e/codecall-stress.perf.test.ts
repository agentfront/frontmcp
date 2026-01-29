/**
 * Sequential Stress Tests for CodeCall/CRM System (1000 iterations)
 *
 * Tests CRM operations under sustained sequential load
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('CodeCall Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-codecall/src/main.ts',
    project: 'demo-e2e-codecall',
    publicMode: true,
  });

  perfTest('stress test: 1000 users-list operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('users-list', {});
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
      `[STRESS] users-list: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 users-create operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('users-create', {
          name: `User ${counter}`,
          email: `user${counter}@test.com`,
          company: `Company ${counter}`,
          role: counter++ % 2 === 0 ? 'admin' : 'user',
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
      `[STRESS] users-create: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 activities-list operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('activities-list', {});
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] activities-list: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 mixed CRM operations', async ({ mcp, perf }) => {
    // Reset CRM store before leak detection to prevent accumulation from warmup
    await mcp.tools.call('crm-reset', {});

    let callIndex = 0;
    const result = await perf.checkLeak(
      async () => {
        const op = callIndex++ % 4;
        if (op === 0) {
          await mcp.tools.call('users-list', {});
        } else if (op === 1) {
          await mcp.tools.call('users-create', {
            name: `User ${callIndex}`,
            email: `user${callIndex}@test.com`,
            company: 'Test',
            role: 'user',
          });
        } else if (op === 2) {
          await mcp.tools.call('activities-list', {});
        } else {
          await mcp.tools.call('activities-stats', {});
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
