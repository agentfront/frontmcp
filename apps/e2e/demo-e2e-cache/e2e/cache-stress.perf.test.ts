/**
 * Sequential Stress Tests for CachePlugin (1000 iterations)
 *
 * Tests cache system under sustained sequential load
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Cache Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-cache/src/main.ts',
    project: 'demo-e2e-cache',
    publicMode: true,
  });

  perfTest('stress test: 1000 cache operations with unique keys', async ({ mcp, perf }) => {
    await mcp.tools.call('reset-stats', {});

    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('expensive-operation', {
          operationId: `stress-${Math.random().toString(36).slice(2)}`,
          complexity: 2,
        });
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB for 1000 iterations
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] cache (unique keys): ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 cache hits (same key)', async ({ mcp, perf }) => {
    await mcp.tools.call('reset-stats', {});

    // Pre-populate cache
    await mcp.tools.call('expensive-operation', {
      operationId: 'stress-cached-key',
      complexity: 3,
    });

    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('expensive-operation', {
          operationId: 'stress-cached-key',
          complexity: 3,
        });
      },
      {
        iterations: 1000,
        threshold: 80 * 1024 * 1024, // 80MB - cache hits should use less memory
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] cache hits: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(150 * 1024); // Cache hits should be lighter
  });

  perfTest('stress test: 1000 non-cached operations', async ({ mcp, perf }) => {
    await mcp.tools.call('reset-stats', {});

    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('non-cached', {
          operationId: `non-cached-${Math.random().toString(36).slice(2)}`,
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
      `[STRESS] non-cached: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 resource reads', async ({ mcp, perf }) => {
    await mcp.tools.call('reset-stats', {});

    // Populate some cache data
    for (let i = 0; i < 10; i++) {
      await mcp.tools.call('expensive-operation', {
        operationId: `resource-stress-${i}`,
        complexity: 1,
      });
    }

    const result = await perf.checkLeak(
      async () => {
        await mcp.resources.read('cache://stats');
      },
      {
        iterations: 1000,
        threshold: 80 * 1024 * 1024, // 80MB - resource reads should be light
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] resource reads: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(150 * 1024);
  });
});
