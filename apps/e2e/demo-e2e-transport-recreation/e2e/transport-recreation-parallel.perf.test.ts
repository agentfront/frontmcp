/**
 * Parallel Stress Tests for Transport Recreation System (5 workers × 1000 iterations)
 *
 * Tests stateful transport operations under parallel load using multiple clients
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Transport Recreation Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-transport-recreation/src/main.ts',
    project: 'demo-e2e-transport-recreation',
    publicMode: true,
  });

  perfTest('parallel stress: 5000 total increment-counter operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.call('increment-counter', {});
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
      `[PARALLEL] increment-counter: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total mixed stateful operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 2;
          if (op === 0) {
            await client.tools.call('increment-counter', {});
          } else {
            await client.tools.call('get-session-info', {});
          }
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
      `[PARALLEL] mixed operations: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total tool listings', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client) => async () => {
        await client.tools.list();
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
      `[PARALLEL] tools.list: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });
});
