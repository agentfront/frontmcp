/**
 * Parallel Stress Tests for Notifications System (5 workers × 1000 iterations)
 *
 * Tests notification operations under parallel load using multiple clients
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Notifications Parallel Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-notifications/src/main.ts',
    project: 'demo-e2e-notifications',
    publicMode: true,
  });

  perfTest('parallel stress: 5000 total trigger-progress operations', async ({ perf, server }) => {
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let counter = workerId * 1000;
        return async () => {
          await client.tools.call('trigger-progress', {
            level: 'info',
            message: `Progress update ${counter++}`,
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
      `[PARALLEL] trigger-progress: ${result.totalRequestsPerSecond.toFixed(1)} req/s total ` +
        `(${result.workersUsed} workers × ${result.totalIterations / result.workersUsed} iterations)`,
    );

    expect(result.totalRequestsPerSecond).toBeGreaterThan(200);
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('parallel stress: 5000 total mixed notification operations', async ({ perf, server }) => {
    const levels = ['debug', 'info', 'notice', 'warning', 'error'] as const;
    const result = await perf.checkLeakParallel(
      (client, workerId) => {
        let callIndex = workerId;
        return async () => {
          const op = callIndex++ % 2;
          if (op === 0) {
            await client.tools.call('trigger-progress', {
              level: levels[callIndex % levels.length],
              message: `Message ${callIndex}`,
            });
          } else {
            await client.tools.call('trigger-resource-change', {
              resourceUri: `test://resource-${callIndex % 10}`,
            });
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
