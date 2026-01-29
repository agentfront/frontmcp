/**
 * Sequential Stress Tests for Config System (1000 iterations)
 *
 * Tests configuration operations under sustained sequential load
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Config Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-config/src/main.ts',
    project: 'demo-e2e-config',
    publicMode: true,
  });

  perfTest('stress test: 1000 get-config operations', async ({ mcp, perf }) => {
    const keys = ['NODE_ENV', 'PORT', 'DEBUG', 'LOG_LEVEL', 'APP_NAME'];
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('get-config', {
          key: keys[counter++ % keys.length],
          defaultValue: 'default',
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
      `[STRESS] get-config: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 check-config operations', async ({ mcp, perf }) => {
    const keys = ['NODE_ENV', 'PORT', 'DEBUG', 'NONEXISTENT', 'ANOTHER'];
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('check-config', {
          key: keys[counter++ % keys.length],
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
      `[STRESS] check-config: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 get-all-config operations', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('get-all-config', {});
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] get-all-config: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 mixed config operations', async ({ mcp, perf }) => {
    let callIndex = 0;
    const result = await perf.checkLeak(
      async () => {
        const op = callIndex++ % 3;
        if (op === 0) {
          await mcp.tools.call('get-config', { key: 'NODE_ENV', defaultValue: 'test' });
        } else if (op === 1) {
          await mcp.tools.call('check-config', { key: 'PORT' });
        } else {
          await mcp.tools.call('get-all-config', {});
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
