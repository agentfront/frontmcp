/**
 * Sequential Stress Tests for Remember/Memory System (1000 iterations)
 *
 * Tests memory operations under sustained sequential load
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Remember Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-remember/src/main.ts',
    project: 'demo-e2e-remember',
    publicMode: true,
  });

  perfTest('stress test: 1000 remember-value operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('remember-value', {
          key: `key-${counter}`,
          value: `value-${counter++}`,
          scope: 'session',
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
      `[STRESS] remember-value: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 recall-value operations', async ({ mcp, perf }) => {
    // First, store some values to recall
    for (let i = 0; i < 10; i++) {
      await mcp.tools.call('remember-value', {
        key: `recall-key-${i}`,
        value: `recall-value-${i}`,
        scope: 'session',
      });
    }

    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('recall-value', {
          key: `recall-key-${counter++ % 10}`,
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
      `[STRESS] recall-value: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 list-memories operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('list-memories', {});
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] list-memories: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 mixed memory operations', async ({ mcp, perf }) => {
    let callIndex = 0;
    const result = await perf.checkLeak(
      async () => {
        const op = callIndex++ % 4;
        if (op === 0) {
          await mcp.tools.call('remember-value', {
            key: `mix-key-${callIndex}`,
            value: `mix-val-${callIndex}`,
            scope: 'session',
          });
        } else if (op === 1) {
          await mcp.tools.call('recall-value', { key: `mix-key-${callIndex % 100}` });
        } else if (op === 2) {
          await mcp.tools.call('list-memories', {});
        } else {
          await mcp.tools.call('check-memory', { key: `mix-key-${callIndex % 100}` });
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
