/**
 * Parallel Stress Tests for CachePlugin (5 workers × 1000 iterations)
 *
 * Tests cache system under parallel load using multiple clients
 * to achieve higher throughput (400-2000+ req/s)
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Cache Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-cache/src/main.ts',
    project: 'demo-e2e-cache',
    publicMode: true,
  });

  perfTest('parallel stress: 5000 total cache operations (unique keys)', async ({ mcp, perf, server }) => {
    await mcp.tools.call('reset-stats', {});

    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = 0;
        return async () => {
          await client.tools.call('expensive-operation', {
            operationId: `parallel-${workerId}-${counter++}`,
            complexity: 2,
          });
        };
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
      `[PARALLEL] cache (unique keys): ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    // 5 workers × ~80 req/s = ~400 req/s expected
    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total cache hits (shared keys)', async ({ mcp, perf, server }) => {
    await mcp.tools.call('reset-stats', {});

    // Pre-populate cache with 10 keys
    for (let i = 0; i < 10; i++) {
      await mcp.tools.call('expensive-operation', {
        operationId: `shared-key-${i}`,
        complexity: 3,
      });
    }

    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = workerId;
        return async () => {
          await client.tools.call('expensive-operation', {
            operationId: `shared-key-${counter++ % 10}`,
            complexity: 3,
          });
        };
      },
      {
        iterations: 1000,
        workers: 5,
        threshold: 180 * 1024 * 1024, // Cache hits should use less memory
        warmupIterations: 10,
        intervalSize: 200,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] cache hits: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(150 * 1024);
  });

  perfTest('parallel stress: 5000 total non-cached operations', async ({ mcp, perf, server }) => {
    await mcp.tools.call('reset-stats', {});

    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = 0;
        return async () => {
          await client.tools.call('non-cached', {
            operationId: `parallel-nc-${workerId}-${counter++}`,
          });
        };
      },
      {
        iterations: 1000,
        workers: 5,
        threshold: 200 * 1024 * 1024,
        warmupIterations: 10,
        intervalSize: 200,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] non-cached: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total resource reads', async ({ mcp, perf, server }) => {
    await mcp.tools.call('reset-stats', {});

    // Populate some cache data
    for (let i = 0; i < 10; i++) {
      await mcp.tools.call('expensive-operation', {
        operationId: `parallel-resource-${i}`,
        complexity: 1,
      });
    }

    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.resources.read('cache://stats');
      },
      {
        iterations: 1000,
        workers: 5,
        threshold: 180 * 1024 * 1024, // Resource reads should be light
        warmupIterations: 10,
        intervalSize: 200,
        clientFactory: () => server.createClient(),
      },
    );

    console.log(
      `[PARALLEL] resource reads: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(150 * 1024);
  });
});
